import { useEffect, type CSSProperties } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authorizeUrl, disconnect, listReels } from "../lib/instagram.server";
import { processPending, refreshStatuses, resumeIfStuck, syncAuto, type Admin } from "../lib/reels.server";
import { AUTO_COUNT } from "../lib/constants";
import { themeSupportsAppBlocks } from "../lib/theme.server";

/**
 * ReelStage shows the store's newest Instagram reels (AUTO_COUNT of them) automatically.
 * Opening the app checks Instagram for new reels; the oldest one drops off when a new one arrives.
 */
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

  const account = await db.instagramAccount.findUnique({ where: { shop } });
  let igError: string | null = null;
  if (account) {
    try {
      const reels = await listReels(shop, AUTO_COUNT);
      await syncAuto(admin as unknown as Admin, shop, reels);
    } catch (e) {
      igError = e instanceof Error ? e.message : String(e);
    }
    try {
      await refreshStatuses(admin as unknown as Admin, shop);
      await resumeIfStuck(shop);
    } catch (e) {
      console.error("refreshStatuses", e);
    }
  }
  const theme = await themeSupportsAppBlocks(admin as unknown as Admin);
  const selected = await db.selectedReel.findMany({ where: { shop }, orderBy: { position: "asc" } });

  return {
    shop,
    apiKey: process.env.SHOPIFY_API_KEY || "",
    authUrl,
    setupError,
    justConnected: url.searchParams.get("connected") === "1",
    account: account ? { username: account.username } : null,
    igError,
    theme,
    count: AUTO_COUNT,
    selected: selected.map((s) => ({
      mediaId: s.mediaId,
      status: s.status,
      error: s.error,
      caption: s.caption,
      image: s.posterUrl || s.igThumbnail,
      permalink: s.permalink,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  try {
    if (intent === "refresh") {
      const changed = await syncAuto(admin as unknown as Admin, shop);
      return { ok: true, message: changed ? "Updated with your newest reels." : "Already up to date." };
    }
    if (intent === "retry") {
      await db.selectedReel.updateMany({ where: { shop, status: "failed" }, data: { status: "processing", fileId: null, error: null } });
      processPending(shop);
      return { ok: true, message: "Trying again…" };
    }
    if (intent === "disconnect") {
      await disconnect(shop);
      return { ok: true, message: "Instagram disconnected. Reels already on your store stay there." };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, message: "Unknown action" };
};

const card: CSSProperties = {
  position: "relative",
  border: "1px solid #e3e3e3",
  borderRadius: 12,
  overflow: "hidden",
  background: "#fff",
  display: "flex",
  flexDirection: "column",
};
const thumb: CSSProperties = { width: "100%", aspectRatio: "9 / 16", objectFit: "cover", background: "#f1f1f1", display: "block" };
const num: CSSProperties = {
  position: "absolute", top: 8, left: 8, minWidth: 24, height: 24, padding: "0 6px", borderRadius: 12, background: "#111",
  color: "#fff", display: "grid", placeItems: "center", fontWeight: 700, fontSize: 12,
};

export default function Reels() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const busy = nav.state !== "idle";

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

  const editorUrl = `https://${d.shop}/admin/themes/current/editor?template=index&addAppBlockId=${d.apiKey}/reels&target=newAppsSection`;

  if (!d.account) {
    return (
      <s-page heading="ReelStage">
        <s-section heading="Connect your Instagram">
          <s-stack gap="base">
            {d.setupError && <s-banner tone="critical">{d.setupError}</s-banner>}
            <s-paragraph>
              Show your newest Instagram reels on your store. Connect your Instagram account and add the “ReelStage reels” block
              to any page in the theme editor. Your {d.count} newest reels are shown automatically, and new reels are added by
              themselves.
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

  const ready = d.selected.filter((s) => s.status === "ready").length;
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

      <s-section heading={`Shown on your store: your ${d.count} newest reels`}>
        <s-stack gap="base">
          {d.igError && <s-banner tone="critical">{d.igError}</s-banner>}
          <s-paragraph>
            <s-text color="subdued">
              {ready} of {d.selected.length} ready. When you post a new reel, it is added first and the oldest one drops off.
              This page checks Instagram each time you open it.
            </s-text>
          </s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button onClick={() => post({ intent: "refresh" })} disabled={busy}>
              Check for new reels now
            </s-button>
            {failed.length > 0 && <s-button onClick={() => post({ intent: "retry" })}>Try failed reels again</s-button>}
          </s-stack>
          {d.selected.length === 0 ? (
            <s-paragraph>No reels found on @{d.account.username} yet.</s-paragraph>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
              {d.selected.map((s, i) => (
                <div key={s.mediaId} style={card}>
                  {s.image ? <img src={s.image} alt="" style={thumb} loading="lazy" /> : <div style={thumb} />}
                  <span style={num}>{i + 1}</span>
                  <div style={{ padding: 8, display: "grid", gap: 6 }}>
                    {s.status === "ready" && <s-badge tone="success">On store</s-badge>}
                    {s.status === "processing" && <s-badge tone="info">Copying…</s-badge>}
                    {s.status === "failed" && <s-badge tone="critical">Failed</s-badge>}
                    {s.error && <s-text color="subdued">{s.error}</s-text>}
                    {s.caption && (
                      <span style={{ color: "#303030", fontSize: 12, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                        {s.caption}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {d.theme.supported === false && (
            <s-banner tone="warning">
              Your live theme{d.theme.themeName ? ` (${d.theme.themeName})` : ""} is an older theme that doesn’t support app
              blocks, so the reels can’t be added to it. Switch to any free Online Store 2.0 theme (for example Dawn) from the
              Shopify Theme Store, or ask your theme developer to update it.
            </s-banner>
          )}
          <s-paragraph>
            Add the reels to your store:{" "}
            <s-link href={editorUrl} target="_blank">
              open the theme editor
            </s-link>{" "}
            → the “ReelStage reels” block is added to your home page → Save.
          </s-paragraph>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
