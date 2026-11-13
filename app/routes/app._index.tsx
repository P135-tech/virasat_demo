import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authorizeUrl, disconnect, listReels, type Reel } from "../lib/instagram.server";
import { forgetOldInstall, removeInstagramReels, setLayout, setStorage, storageFor, publishToStore, processPending, refreshInstagramLinks, refreshStatuses, resumeIfStuck, saveSelection, type Admin } from "../lib/reels.server";
import { LIST_COUNT, MAX_REELS } from "../lib/constants";
import { themeSupportsAppBlocks } from "../lib/theme.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);

  let authUrl = "";
  let setupError: string | null = null;
  try {
    authUrl = authorizeUrl(shop);
  } catch (e) {
    setupError = e instanceof Error ? e.message : String(e);
  }

  try {
    await forgetOldInstall(admin as unknown as Admin, shop);
  } catch (e) {
    console.error("forgetOldInstall", e);
  }
  const account = await db.instagramAccount.findUnique({ where: { shop } });
  let reels: Reel[] = [];
  let igError: string | null = null;
  if (account) {
    try {
      // Only the newest reels are offered to choose from.
      reels = await listReels(shop, LIST_COUNT);
    } catch (e) {
      igError = e instanceof Error ? e.message : String(e);
    }
    try {
      await refreshInstagramLinks(shop);
      await refreshStatuses(admin as unknown as Admin, shop);
      await resumeIfStuck(shop);
    } catch (e) {
      console.error("refreshStatuses", e);
    }
  }
  const theme = await themeSupportsAppBlocks(admin as unknown as Admin);
  const layout = (await db.reelSettings.findUnique({ where: { shop } }))?.layout === "strip" ? "strip" : "stage";
  const storage = await storageFor(shop);
  const selected = await db.selectedReel.findMany({ where: { shop }, orderBy: { position: "asc" } });

  return {
    shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    authUrl,
    setupError,
    justConnected: url.searchParams.get("connected") === "1",
    account: account ? { username: account.username, expires: account.tokenExpiresAt.toISOString() } : null,
    reels,
    igError,
    theme,
    layout,
    storage,
    selected: selected.map((s) => ({
      mediaId: s.mediaId,
      status: s.status,
      error: s.error,
      caption: s.caption,
      image: s.posterUrl || s.igThumbnail,
      permalink: s.permalink,
      fromInstagram: s.status === "ready" && !s.fileId,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const a = admin as unknown as Admin;
  try {
    if (intent === "storage") {
      const v = String(fd.get("storage"));
      await setStorage(a, shop, v);
      return {
        ok: true,
        message: v === "files" ? "Copying your reels to Shopify Files…" : "New reels now play straight from Instagram.",
      };
    }
    if (intent === "layout") {
      await setLayout(a, shop, String(fd.get("layout")));
      return { ok: true, message: "Layout saved. Refresh your store to see it." };
    }
    if (intent === "save") {
      const chosen = JSON.parse(String(fd.get("chosen") || "[]")) as {
        id: string;
        caption: string | null;
        permalink: string | null;
        thumbnail: string | null;
      }[];
      await saveSelection(a, shop, chosen);
      const files = (await storageFor(shop)) === "files";
      return {
        ok: true,
        message: !chosen.length
          ? "Saved. No reels are shown now."
          : files
            ? "Saved. New reels are being copied to your store."
            : "Saved. Your reels are now on your store.",
      };
    }
    if (intent === "move" || intent === "remove") {
      const mediaId = String(fd.get("mediaId"));
      const rows = await db.selectedReel.findMany({ where: { shop }, orderBy: { position: "asc" } });
      let ids = rows.map((r) => r.mediaId);
      const i = ids.indexOf(mediaId);
      if (i >= 0 && intent === "remove") ids.splice(i, 1);
      if (i >= 0 && intent === "move") {
        const j = i + (String(fd.get("dir")) === "up" ? -1 : 1);
        if (j >= 0 && j < ids.length) [ids[i], ids[j]] = [ids[j], ids[i]];
      }
      if (intent === "remove") await db.selectedReel.deleteMany({ where: { shop, mediaId } });
      ids = ids.filter((x) => x !== (intent === "remove" ? mediaId : ""));
      for (let k = 0; k < ids.length; k++) {
        await db.selectedReel.update({ where: { shop_mediaId: { shop, mediaId: ids[k] } }, data: { position: k } });
      }
      await publishToStore(a, shop);
      return { ok: true, message: intent === "remove" ? "Removed from your store." : "Order updated." };
    }
    if (intent === "retry") {
      await db.selectedReel.updateMany({ where: { shop, status: "failed" }, data: { status: "processing", fileId: null, error: null } });
      processPending(shop);
      return { ok: true, message: "Trying again…" };
    }
    if (intent === "disconnect") {
      await disconnect(shop);
      await removeInstagramReels(shop, { admin: a });
      return { ok: true, message: "Instagram disconnected. Reels played from Instagram were removed from your store." };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, message: "Unknown action" };
};

const card: CSSProperties = {
  border: "1px solid #e3e3e3",
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
};
const thumb: CSSProperties = { width: "100%", aspectRatio: "9 / 16", objectFit: "cover", background: "#f1f1f1", display: "block" };

function when(ts: string | null) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return "";
  }
}

export default function Reels() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const busy = nav.state !== "idle";

  const savedIds = useMemo(() => d.selected.map((s) => s.mediaId), [d.selected]);
  const [chosen, setChosen] = useState<string[]>(savedIds);
  useEffect(() => setChosen(savedIds), [savedIds]);
  const dirty = chosen.join(",") !== savedIds.join(",");

  useEffect(() => {
    if (result?.message) shopify.toast.show(result.message, { isError: !result.ok });
  }, [result, shopify]);
  useEffect(() => {
    if (d.justConnected) shopify.toast.show("Instagram connected");
  }, [d.justConnected, shopify]);

  // While Shopify is still processing videos, check again every few seconds.
  const processing = d.selected.some((s) => s.status === "processing");
  useEffect(() => {
    if (!processing) return;
    const t = setInterval(() => {
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 6000);
    return () => clearInterval(t);
  }, [processing, revalidator]);

  function connect() {
    if (d.authUrl) window.open(d.authUrl, "_top");
  }
  function post(data: Record<string, string>) {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    submit(fd, { method: "post" });
  }
  function toggle(id: string) {
    setChosen((c) => {
      if (c.includes(id)) return c.filter((x) => x !== id);
      if (c.length >= MAX_REELS) {
        shopify.toast.show(`You can show up to ${MAX_REELS} reels.`, { isError: true });
        return c;
      }
      return [...c, id];
    });
  }
  function save() {
    const byId = new Map(d.reels.map((r) => [r.id, r]));
    const saved = new Map(d.selected.map((s) => [s.mediaId, s]));
    const payload = chosen.map((id) => {
      const r = byId.get(id);
      const s = saved.get(id);
      return { id, caption: r?.caption ?? s?.caption ?? null, permalink: r?.permalink ?? s?.permalink ?? null, thumbnail: r?.thumbnail ?? null };
    });
    post({ intent: "save", chosen: JSON.stringify(payload) });
  }

  const editorUrl = `https://${d.shop}/admin/themes/current/editor?template=index&addAppBlockId=${d.apiKey}/reels&target=newAppsSection`;

  if (!d.account) {
    return (
      <s-page heading="ReelStage">
        <s-section heading="Connect your Instagram">
          <s-stack gap="base">
            {d.setupError && <s-banner tone="critical">{d.setupError}</s-banner>}
            <s-paragraph>
              Show your Instagram reels on your store. Connect your Instagram account, choose the reels you like, and add the
              “ReelStage reels” block to any page in the theme editor.
            </s-paragraph>
            <s-paragraph>
              You will sign in on Meta’s own page with the Facebook account that manages your Facebook Page. This app never
              sees your password and only reads your posts; it never posts or changes anything on Instagram or Facebook.
            </s-paragraph>
            <s-banner tone="info">
              Your Instagram must be a <s-text type="strong">Business</s-text> or <s-text type="strong">Creator</s-text> account{" "}
              <s-text type="strong">linked to a Facebook Page</s-text>. Both are free: in Instagram go to Settings → Account type and
              tools to switch, and Accounts Center (or Meta Business Suite) to link your Page. When Meta asks, tick that Page and
              its Instagram account.
            </s-banner>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={connect} disabled={!d.authUrl}>
                Connect Instagram
              </s-button>
            </s-stack>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const shownCount = d.selected.filter((s) => s.status === "ready").length;
  const failed = d.selected.filter((s) => s.status === "failed");

  return (
    <s-page heading="ReelStage">
      <s-section heading="Instagram account">
        <s-stack direction="inline" gap="base">
          <s-paragraph>
            Connected to <s-text type="strong">@{d.account.username}</s-text>
          </s-paragraph>
          <s-button onClick={connect}>Reconnect</s-button>
          <s-button tone="critical" onClick={() => post({ intent: "disconnect" })}>
            Disconnect
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Layout on your store">
        <s-stack gap="base">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {LAYOUT_CHOICES.map((l) => {
              const on = d.layout === l.id;
              return (
                <button
                  key={l.id}
                  type="button"
                  disabled={busy}
                  onClick={() => !on && post({ intent: "layout", layout: l.id })}
                  aria-pressed={on}
                  style={{
                    flex: "1 1 260px", maxWidth: 380, textAlign: "left", padding: 14, borderRadius: 14, cursor: on ? "default" : "pointer",
                    font: "inherit", background: on ? "#f6f6f7" : "#fff", border: on ? "2px solid #111" : "1px solid #d4d4d4",
                  }}
                >
                  <LayoutPicture kind={l.id} />
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontWeight: 700 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #111", display: "grid", placeItems: "center" }}>
                      {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#111" }} />}
                    </span>
                    {l.name}
                    {on && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#0a7d35" }}>In use</span>}
                  </div>
                  <div style={{ color: "#616161", fontSize: 13, marginTop: 4 }}>{l.text}</div>
                </button>
              );
            })}
          </div>
          <s-paragraph>
            <s-text color="subdued">
              Both layouts play a short preview of the centre reel, then move to the next one. Shoppers press play to watch the
              full reel. You can also change the layout per page in the theme editor.
            </s-text>
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Where the videos play from">
        <s-stack gap="base">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {STORAGE_CHOICES.map((o) => {
              const on = d.storage === o.id;
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={busy}
                  onClick={() => !on && post({ intent: "storage", storage: o.id })}
                  aria-pressed={on}
                  style={{
                    flex: "1 1 260px", maxWidth: 380, textAlign: "left", padding: 14, borderRadius: 14, cursor: on ? "default" : "pointer",
                    font: "inherit", background: on ? "#f6f6f7" : "#fff", border: on ? "2px solid #111" : "1px solid #d4d4d4",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700 }}>
                    <span style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid #111", display: "grid", placeItems: "center" }}>
                      {on && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#111" }} />}
                    </span>
                    {o.name}
                    {on && <span style={{ marginLeft: "auto", fontSize: 12, fontWeight: 600, color: "#0a7d35" }}>In use</span>}
                  </div>
                  <div style={{ color: "#616161", fontSize: 13, marginTop: 6 }}>{o.text}</div>
                </button>
              );
            })}
          </div>
        </s-stack>
      </s-section>

      <s-section heading={`On your store (${shownCount} of ${d.selected.length} ready)`}>
        <s-stack gap="base">
          {d.selected.length === 0 ? (
            <s-paragraph>No reels chosen yet. Tick reels below and click Save. The order you tick them in is the order on your store.</s-paragraph>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
              {d.selected.map((s, i) => (
                <div key={s.mediaId} style={card}>
                  {s.image ? <img src={s.image} alt="" style={thumb} /> : <div style={thumb} />}
                  <div style={{ padding: 8, display: "grid", gap: 6 }}>
                    {s.status === "ready" && <s-badge tone="success">On store</s-badge>}
                    {s.fromInstagram && d.storage === "files" && <s-text color="subdued">Plays from Instagram (couldn’t copy)</s-text>}
                    {s.status === "processing" && <s-badge tone="info">Copying…</s-badge>}
                    {s.status === "failed" && <s-badge tone="critical">Failed</s-badge>}
                    {s.error && <s-text color="subdued">{s.error}</s-text>}
                    <s-stack direction="inline" gap="small">
                      <s-button disabled={i === 0 || busy} onClick={() => post({ intent: "move", mediaId: s.mediaId, dir: "up" })} accessibilityLabel="Move left">
                        ←
                      </s-button>
                      <s-button disabled={i === d.selected.length - 1 || busy} onClick={() => post({ intent: "move", mediaId: s.mediaId, dir: "down" })} accessibilityLabel="Move right">
                        →
                      </s-button>
                      <s-button tone="critical" disabled={busy} onClick={() => post({ intent: "remove", mediaId: s.mediaId })}>
                        Remove
                      </s-button>
                    </s-stack>
                  </div>
                </div>
              ))}
            </div>
          )}
          {failed.length > 0 && (
            <s-stack direction="inline">
              <s-button onClick={() => post({ intent: "retry" })}>Try failed reels again</s-button>
            </s-stack>
          )}
          {d.theme.supported === false && (
            <s-banner tone="warning">
              Your live theme{d.theme.themeName ? ` (${d.theme.themeName})` : ""} is an older theme that doesn’t support app
              blocks, so the reels can’t be added to it. Switch to any free Online Store 2.0 theme (for example Dawn) from the
              Shopify Theme Store, or ask your theme developer to update it.
            </s-banner>
          )}
          <s-paragraph>
            Then add the block to your store:{" "}
            <s-link href={editorUrl} target="_blank">
              open the theme editor
            </s-link>{" "}
            → the “ReelStage reels” block is added to your home page → Save.
          </s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading={`Your ${LIST_COUNT} newest Instagram reels (${chosen.length} chosen)`}>
        <s-stack gap="base">
          {d.igError && <s-banner tone="critical">{d.igError}</s-banner>}
          {!d.igError && d.reels.length === 0 && <s-paragraph>No reels found on @{d.account.username} yet.</s-paragraph>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {d.reels.map((r) => {
              const on = chosen.includes(r.id);
              const n = chosen.indexOf(r.id) + 1;
              return (
                <label
                  key={r.id}
                  style={{ ...card, cursor: "pointer", outline: on ? "3px solid #111111" : "none", outlineOffset: -1, position: "relative" }}
                >
                  {r.thumbnail ? <img src={r.thumbnail} alt="" style={thumb} loading="lazy" /> : <div style={thumb} />}
                  {on && (
                    <span
                      style={{
                        position: "absolute", top: 8, left: 8, minWidth: 26, height: 26, borderRadius: 13, background: "#111111",
                        color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 13,
                      }}
                    >
                      {n}
                    </span>
                  )}
                  <span style={{ padding: "8px 10px", display: "grid", gap: 4 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <input type="checkbox" checked={on} onChange={() => toggle(r.id)} />
                      <span style={{ fontWeight: 600, fontSize: 13 }}>{on ? "Shown on store" : "Show on store"}</span>
                    </span>
                    <span style={{ color: "#616161", fontSize: 12 }}>{when(r.timestamp)}</span>
                    {r.caption && (
                      <span style={{ color: "#303030", fontSize: 12, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {r.caption}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
          <s-stack direction="inline" gap="base">
            <s-button variant="primary" onClick={save} disabled={!dirty || busy}>
              Save
            </s-button>
            {dirty && <s-text color="subdued">You have unsaved changes.</s-text>}
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

const STORAGE_CHOICES = [
  {
    id: "instagram",
    name: "Play from Instagram (recommended)",
    text: "Nothing is downloaded. Reels show on your store straight away and stay in sync with Instagram.",
  },
  {
    id: "files",
    name: "Copy to Shopify Files",
    text: "Each reel is copied into your store’s Files, so it keeps playing even if you disconnect Instagram. Some Shopify plans limit video uploads per week.",
  },
] as const;

const LAYOUT_CHOICES = [
  { id: "stage", name: "Centre stage", text: "The playing reel in the middle, smaller tilted reels on each side." },
  { id: "strip", name: "Strip", text: "A row of reel thumbnails; the playing reel in the middle is taller." },
] as const;

/** Small drawing of each layout for the picker. */
function LayoutPicture({ kind }: { kind: "stage" | "strip" }) {
  const box: CSSProperties = { display: "block", width: "100%", height: 120, borderRadius: 10, background: "#efeaf6" };
  if (kind === "stage") {
    return (
      <svg viewBox="0 0 300 120" style={box} aria-hidden="true">
        <rect x="38" y="30" width="44" height="72" rx="8" fill="#b9a9d6" transform="skewY(4)" opacity=".75" />
        <rect x="80" y="22" width="52" height="84" rx="9" fill="#a08cc8" />
        <rect x="218" y="30" width="44" height="72" rx="8" fill="#b9a9d6" transform="skewY(-4)" opacity=".75" />
        <rect x="168" y="22" width="52" height="84" rx="9" fill="#a08cc8" />
        <rect x="120" y="8" width="60" height="106" rx="10" fill="url(#g1)" stroke="#d62976" strokeWidth="3" />
        <path d="M144 52 L162 61 L144 70 Z" fill="#fff" />
        <defs>
          <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#ffc15e" />
            <stop offset="1" stopColor="#f0457a" />
          </linearGradient>
        </defs>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 300 120" style={box} aria-hidden="true">
      {[-3, -2, -1, 1, 2, 3].map((k) => (
        <rect key={k} x={150 + k * 46 - 20 + (k > 0 ? 6 : -6)} y="22" width="40" height="76" rx="7" fill="#a08cc8" />
      ))}
      <rect x="122" y="8" width="56" height="104" rx="9" fill="url(#g2)" stroke="#d62976" strokeWidth="3" />
      <path d="M144 52 L162 61 L144 70 Z" fill="#fff" />
      <defs>
        <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffc15e" />
          <stop offset="1" stopColor="#f0457a" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
