import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRevalidator, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { authorizeUrl, disconnect, listReels, type Reel } from "../lib/instagram.server";
import {
  getSettings,
  processPending,
  publishToStore,
  refreshStatuses,
  resumeIfStuck,
  saveSelection,
  syncAuto,
  updateSettings,
  type Admin,
} from "../lib/reels.server";
import { AUTO_COUNT, MAX_REELS } from "../lib/constants";
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

  const account = await db.instagramAccount.findUnique({ where: { shop } });
  const settings = await getSettings(shop);
  let reels: Reel[] = [];
  let igError: string | null = null;
  if (account) {
    try {
      reels = await listReels(shop);
    } catch (e) {
      igError = e instanceof Error ? e.message : String(e);
    }
    // Automatic mode: pick up new or newly pinned reels each time the app is opened.
    if (!igError && settings.mode === "auto") {
      try {
        await syncAuto(admin as unknown as Admin, shop, reels);
      } catch (e) {
        console.error("syncAuto", e);
      }
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
    account: account ? { username: account.username, expires: account.tokenExpiresAt.toISOString() } : null,
    reels,
    igError,
    theme,
    settings: { mode: settings.mode, count: settings.count, pins: settings.pins },
    selected: selected.map((s) => ({
      mediaId: s.mediaId,
      status: s.status,
      error: s.error,
      caption: s.caption,
      image: s.posterUrl || s.igThumbnail,
      permalink: s.permalink,
      pinned: s.pinned,
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
    if (intent === "save") {
      const chosen = JSON.parse(String(fd.get("chosen") || "[]")) as {
        id: string;
        caption: string | null;
        permalink: string | null;
        thumbnail: string | null;
      }[];
      await saveSelection(a, shop, chosen);
      return { ok: true, message: chosen.length ? "Saved. New reels are being copied to your store." : "Saved. No reels are shown now." };
    }
    if (intent === "mode") {
      const mode = String(fd.get("mode")) === "manual" ? "manual" : "auto";
      const count = Math.min(MAX_REELS, Math.max(1, Number(fd.get("count")) || AUTO_COUNT));
      await updateSettings(shop, { mode, count });
      if (mode === "auto") await syncAuto(a, shop);
      return {
        ok: true,
        message: mode === "auto" ? `Automatic: showing pinned reels first, then your newest, ${count} in total.` : "You now choose the reels yourself.",
      };
    }
    if (intent === "pin" || intent === "unpin") {
      const mediaId = String(fd.get("mediaId"));
      const s = await getSettings(shop);
      const pins = s.pins.filter((x) => x !== mediaId);
      if (intent === "pin") pins.push(mediaId);
      await updateSettings(shop, { pins });
      await syncAuto(a, shop);
      return { ok: true, message: intent === "pin" ? "Pinned. It now shows before your newest reels." : "Unpinned." };
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
      return { ok: true, message: "Instagram disconnected. Reels already on your store stay until you remove them." };
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
  const [showAll, setShowAll] = useState(false);
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
  const auto = d.settings.mode === "auto";
  const shownIds = d.selected.map((s) => s.mediaId);

  const pill = (bg: string, fg = "#fff"): CSSProperties => ({
    position: "absolute", top: 8, padding: "3px 8px", borderRadius: 999, background: bg, color: fg,
    fontWeight: 700, fontSize: 11, lineHeight: "16px", boxShadow: "0 2px 6px rgba(0,0,0,.2)",
  });
  const modeBtn = (on: boolean): CSSProperties => ({
    flex: "1 1 240px", textAlign: "left", padding: "14px 16px", borderRadius: 12, cursor: "pointer", font: "inherit",
    border: on ? "2px solid #111" : "1px solid #d4d4d4", background: on ? "#f7f7f7" : "#fff",
  });

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

      <s-section heading="Which reels to show">
        <s-stack gap="base">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <button type="button" style={modeBtn(auto)} disabled={busy} onClick={() => !auto && post({ intent: "mode", mode: "auto", count: String(d.settings.count) })}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{auto ? "● " : "○ "}Automatic (recommended)</div>
              <div style={{ color: "#616161", fontSize: 13 }}>
                Pinned reels first, then your newest reels. New reels are added by themselves.
              </div>
            </button>
            <button type="button" style={modeBtn(!auto)} disabled={busy} onClick={() => auto && post({ intent: "mode", mode: "manual", count: String(d.settings.count) })}>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{!auto ? "● " : "○ "}Choose myself</div>
              <div style={{ color: "#616161", fontSize: 13 }}>Tick the exact reels to show and set their order.</div>
            </button>
          </div>
          {auto && (
            <s-stack direction="inline" gap="base">
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span>Number of reels to show</span>
                <select
                  value={d.settings.count}
                  disabled={busy}
                  onChange={(e) => post({ intent: "mode", mode: "auto", count: e.currentTarget.value })}
                  style={{ padding: "6px 10px", borderRadius: 8, border: "1px solid #c9c9c9", font: "inherit" }}
                >
                  {[4, 6, 8, 10, 12, 15, 20].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
            </s-stack>
          )}
          {auto && (
            <s-paragraph>
              <s-text color="subdued">
                Example with 10: 1 pinned reel + your 9 newest; 3 pinned reels + your 7 newest. Reels pinned on Instagram are
                detected automatically. You can also pin any reel below.
              </s-text>
            </s-paragraph>
          )}
        </s-stack>
      </s-section>

      <s-section heading={auto ? `Shown on your store: ${d.selected.length} reels, pinned first (${shownCount} ready)` : `On your store (${shownCount} of ${d.selected.length} ready)`}>
        <s-stack gap="base">
          {d.selected.length === 0 ? (
            <s-paragraph>{auto ? "No reels found yet." : "No reels chosen yet. Tick reels below and click Save."}</s-paragraph>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(130px, 1fr))", gap: 12 }}>
              {d.selected.map((s, i) => (
                <div key={s.mediaId} style={{ ...card, position: "relative" }}>
                  {s.image ? <img src={s.image} alt="" style={thumb} /> : <div style={thumb} />}
                  <span style={{ ...pill("#111"), left: 8 }}>{i + 1}</span>
                  {s.pinned && <span style={{ ...pill("#d62976"), right: 8 }}>📌 Pinned</span>}
                  <div style={{ padding: 8, display: "grid", gap: 6 }}>
                    {s.status === "ready" && <s-badge tone="success">On store</s-badge>}
                    {s.status === "processing" && <s-badge tone="info">Copying…</s-badge>}
                    {s.status === "failed" && <s-badge tone="critical">Failed</s-badge>}
                    {s.error && <s-text color="subdued">{s.error}</s-text>}
                    {!auto && (
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
                    )}
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

      {auto && !showAll && (
        <s-section heading="Pin a different reel">
          <s-stack gap="base">
            <s-paragraph>
              <s-text color="subdued">
                Only the {d.settings.count} reels above are shown on your store. Want another reel first? Open your other reels
                and pin it.
              </s-text>
            </s-paragraph>
            <s-stack direction="inline">
              <s-button onClick={() => setShowAll(true)}>Show my other reels</s-button>
            </s-stack>
          </s-stack>
        </s-section>
      )}
      {(!auto || showAll) && (
      <s-section heading={auto ? "All your Instagram reels (pin one to show it first)" : `Your Instagram reels (${chosen.length} of ${MAX_REELS} chosen)`}>
        <s-stack gap="base">
          {d.igError && <s-banner tone="critical">{d.igError}</s-banner>}
          {!d.igError && d.reels.length === 0 && <s-paragraph>No reels found on @{d.account.username} yet.</s-paragraph>}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 14 }}>
            {d.reels.map((r) => {
              if (auto) {
                const n = shownIds.indexOf(r.id) + 1;
                const myPin = d.settings.pins.includes(r.id);
                return (
                  <div key={r.id} style={{ ...card, position: "relative", outline: n ? "3px solid #111111" : "none", outlineOffset: -1 }}>
                    {r.thumbnail ? <img src={r.thumbnail} alt="" style={thumb} loading="lazy" /> : <div style={thumb} />}
                    {n > 0 && <span style={{ ...pill("#111"), left: 8 }}>Showing #{n}</span>}
                    {(r.pinned || myPin) && <span style={{ ...pill("#d62976"), right: 8 }}>📌</span>}
                    <span style={{ padding: "8px 10px", display: "grid", gap: 6 }}>
                      <span style={{ color: "#616161", fontSize: 12 }}>
                        {when(r.timestamp)}
                        {r.pinned ? " · Pinned on Instagram" : ""}
                      </span>
                      {r.caption && (
                        <span style={{ color: "#303030", fontSize: 12, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                          {r.caption}
                        </span>
                      )}
                      {!r.pinned && (
                        <s-button disabled={busy} onClick={() => post({ intent: myPin ? "unpin" : "pin", mediaId: r.id })}>
                          {myPin ? "Unpin" : "📌 Pin to top"}
                        </s-button>
                      )}
                    </span>
                  </div>
                );
              }
              const on = chosen.includes(r.id);
              const n = chosen.indexOf(r.id) + 1;
              return (
                <label
                  key={r.id}
                  style={{ ...card, cursor: "pointer", outline: on ? "3px solid #111111" : "none", outlineOffset: -1, position: "relative" }}
                >
                  {r.thumbnail ? <img src={r.thumbnail} alt="" style={thumb} loading="lazy" /> : <div style={thumb} />}
                  {on && <span style={{ ...pill("#111"), left: 8 }}>{n}</span>}
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
          {!auto && (
            <s-stack direction="inline" gap="base">
              <s-button variant="primary" onClick={save} disabled={!dirty || busy}>
                Save
              </s-button>
              {dirty && <s-text color="subdued">You have unsaved changes.</s-text>}
            </s-stack>
          )}
          {auto && (
            <s-stack direction="inline">
              <s-button onClick={() => setShowAll(false)}>Hide</s-button>
            </s-stack>
          )}
        </s-stack>
      </s-section>
      )}
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
