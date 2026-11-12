import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { getReel } from "./instagram.server";

/** The part of the Admin API client this file needs (works for authenticate.admin and unauthenticated.admin). */
export type Admin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

import { MAX_REELS } from "./constants";
export { MAX_REELS };

async function gql<T>(admin: Admin, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data as T;
}

function shortCaption(c: string | null | undefined, n = 120) {
  if (!c) return "";
  const one = c.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/**
 * Copies one reel into the store's Shopify Files:
 * download from Instagram → staged upload → fileCreate. Shopify then processes the video.
 */
async function uploadToFiles(admin: Admin, shop: string, mediaId: string) {
  const reel = await getReel(shop, mediaId);
  if (!reel.mediaUrl) throw new Error("Instagram did not share the video file for this reel.");

  const videoRes = await fetch(reel.mediaUrl);
  if (!videoRes.ok) throw new Error(`Could not download the reel from Instagram (${videoRes.status}).`);
  const bytes = Buffer.from(await videoRes.arrayBuffer());
  const filename = `instagram-reel-${mediaId}.mp4`;

  const staged = await gql<{
    stagedUploadsCreate: {
      stagedTargets: { url: string; resourceUrl: string; parameters: { name: string; value: string }[] }[];
      userErrors: { message: string }[];
    };
  }>(
    admin,
    `#graphql
    mutation Stage($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    { input: [{ resource: "VIDEO", filename, mimeType: "video/mp4", fileSize: String(bytes.length), httpMethod: "POST" }] },
  );
  const err1 = staged.stagedUploadsCreate.userErrors[0];
  if (err1) throw new Error(err1.message);
  const target = staged.stagedUploadsCreate.stagedTargets[0];

  const form = new FormData();
  for (const p of target.parameters) form.append(p.name, p.value);
  form.append("file", new Blob([bytes], { type: "video/mp4" }), filename);
  const up = await fetch(target.url, { method: "POST", body: form });
  if (!up.ok && up.status !== 201 && up.status !== 204) {
    throw new Error(`Upload to Shopify Files failed (${up.status}).`);
  }

  const created = await gql<{
    fileCreate: { files: { id: string; fileStatus: string }[]; userErrors: { message: string }[] };
  }>(
    admin,
    `#graphql
    mutation Create($files: [FileCreateInput!]!) {
      fileCreate(files: $files) {
        files { id fileStatus }
        userErrors { field message }
      }
    }`,
    { files: [{ originalSource: target.resourceUrl, contentType: "VIDEO", alt: shortCaption(reel.caption, 500) || "Instagram reel" }] },
  );
  const err2 = created.fileCreate.userErrors[0];
  if (err2) throw new Error(err2.message);
  return { fileId: created.fileCreate.files[0].id, reel };
}

// One copy job per store at a time (a second Save while copying just joins the running job).
const running = new Set<string>();

/** Starts copying any chosen reels that are not in Shopify Files yet (runs in the background). */
export function processPending(shop: string) {
  if (running.has(shop)) return;
  running.add(shop);
  void (async () => {
    try {
      const { admin } = await unauthenticated.admin(shop);
      for (;;) {
      const todo = await db.selectedReel.findMany({ where: { shop, status: "processing", fileId: null }, take: 1 });
      if (!todo.length) break;
      for (const r of todo) {
        try {
          const { fileId, reel } = await uploadToFiles(admin as unknown as Admin, shop, r.mediaId);
          await db.selectedReel.update({
            where: { id: r.id },
            data: { fileId, caption: reel.caption, permalink: reel.permalink, error: null },
          });
        } catch (e) {
          await db.selectedReel.update({
            where: { id: r.id },
            data: { status: "failed", error: e instanceof Error ? e.message : String(e) },
          });
        }
      }
      }
      // Shopify needs a little time to process each video; keep checking for up to 10 minutes,
      // so the reels appear on the store even if the merchant closes the app.
      for (let i = 0; i < 60; i++) {
        await refreshStatuses(admin as unknown as Admin, shop);
        const left = await db.selectedReel.count({ where: { shop, status: "processing" } });
        if (!left) break;
        await new Promise((r) => setTimeout(r, 10000));
      }
    } catch (e) {
      console.error("processPending failed", e);
    } finally {
      running.delete(shop);
    }
  })();
}

/** After a server restart, picks up reels that were waiting to be copied. */
export async function resumeIfStuck(shop: string) {
  if (running.has(shop)) return;
  const stuck = await db.selectedReel.count({
    where: { shop, status: "processing", fileId: null, updatedAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
  });
  if (stuck) processPending(shop);
}

type VideoNode = {
  id: string;
  fileStatus: string;
  fileErrors?: { message: string }[];
  sources?: { url: string; mimeType: string; height: number }[];
  preview?: { image?: { url: string } | null } | null;
};

/** Checks reels Shopify is still processing; marks them ready (or failed) and updates the storefront list. */
export async function refreshStatuses(admin: Admin, shop: string) {
  const pending = await db.selectedReel.findMany({ where: { shop, status: "processing", NOT: { fileId: null } } });
  if (pending.length) {
    const data = await gql<{ nodes: (VideoNode | null)[] }>(
      admin,
      `#graphql
      query Files($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Video {
            id
            fileStatus
            fileErrors { message }
            sources { url mimeType height }
            preview { image { url } }
          }
        }
      }`,
      { ids: pending.map((p) => p.fileId) },
    );
    for (const node of data.nodes) {
      if (!node) continue;
      const row = pending.find((p) => p.fileId === node.id);
      if (!row) continue;
      if (node.fileStatus === "READY") {
        const mp4 = (node.sources || [])
          .filter((s) => s.mimeType === "video/mp4")
          .sort((a, b) => Math.abs(a.height - 1280) - Math.abs(b.height - 1280))[0];
        await db.selectedReel.update({
          where: { id: row.id },
          data: { status: "ready", videoUrl: mp4?.url ?? node.sources?.[0]?.url ?? null, posterUrl: node.preview?.image?.url ?? null },
        });
      } else if (node.fileStatus === "FAILED") {
        await db.selectedReel.update({
          where: { id: row.id },
          data: { status: "failed", error: node.fileErrors?.[0]?.message || "Shopify could not process this video." },
        });
      }
    }
  }
  await publishToStore(admin, shop);
}

/** Saves the ready reels (in order) where the theme block reads them: app.metafields.reels.selected */
export async function publishToStore(admin: Admin, shop: string) {
  const ready = await db.selectedReel.findMany({ where: { shop, status: "ready" }, orderBy: { position: "asc" } });
  const value = ready.map((r) => ({
    v: r.videoUrl,
    p: r.posterUrl,
    l: r.permalink,
    c: shortCaption(r.caption),
  }));
  const inst = await gql<{ currentAppInstallation: { id: string } }>(admin, `#graphql
    query { currentAppInstallation { id } }`);
  const res = await gql<{ metafieldsSet: { userErrors: { message: string }[] } }>(
    admin,
    `#graphql
    mutation Save($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) { userErrors { field message } }
    }`,
    {
      metafields: [
        { ownerId: inst.currentAppInstallation.id, namespace: "reels", key: "selected", type: "json", value: JSON.stringify(value) },
      ],
    },
  );
  const err = res.metafieldsSet.userErrors[0];
  if (err) throw new Error(err.message);
}

/** Saves the merchant's choice: adds new reels, removes un-ticked ones, keeps the order given. */
export async function saveSelection(
  admin: Admin,
  shop: string,
  chosen: { id: string; caption: string | null; permalink: string | null; thumbnail: string | null }[],
) {
  const list = chosen.slice(0, MAX_REELS);
  const keep = list.map((r) => r.id);
  await db.selectedReel.deleteMany({ where: { shop, mediaId: { notIn: keep.length ? keep : ["-"] } } });
  for (let i = 0; i < list.length; i++) {
    const r = list[i];
    await db.selectedReel.upsert({
      where: { shop_mediaId: { shop, mediaId: r.id } },
      create: { shop, mediaId: r.id, position: i, caption: r.caption, permalink: r.permalink, igThumbnail: r.thumbnail },
      update: { position: i, igThumbnail: r.thumbnail ?? undefined },
    });
  }
  // Failed ones get another try when saved again.
  await db.selectedReel.updateMany({
    where: { shop, status: "failed", mediaId: { in: keep } },
    data: { status: "processing", fileId: null, error: null },
  });
  await publishToStore(admin, shop);
  processPending(shop);
}
