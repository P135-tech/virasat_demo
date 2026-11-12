import db from "../db.server";
import { decrypt, encrypt, signState } from "./crypto.server";

/**
 * Instagram Graph API through Facebook Login for Business.
 * The merchant logs in with the Facebook account that manages their Facebook Page; the app then reads
 * reels from the Instagram Business/Creator account linked to that Page.
 * We keep a Page access token: when it comes from a long-lived user token it does not expire.
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login
 */
const VERSION = process.env.META_GRAPH_VERSION || process.env.IG_GRAPH_VERSION || "v25.0";
const GRAPH = `https://graph.facebook.com/${VERSION}`;

export type Reel = {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnail: string | null;
  mediaUrl: string | null;
  timestamp: string | null;
  /** Pinned to the top of the Instagram profile (detected from the order Meta lists the posts in). */
  pinned: boolean;
};

function env(name: string, fallback?: string): string {
  const v = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!v) throw new Error(`${name} is missing. Add it in Render → Environment.`);
  return v;
}
/** Main Meta App ID and secret (App settings → Basic). */
export function appId() {
  return env("META_APP_ID", "INSTAGRAM_APP_ID");
}
export function appSecret() {
  return env("META_APP_SECRET", "INSTAGRAM_APP_SECRET");
}
/** Facebook Login for Business → Configurations → Configuration ID. */
function configId() {
  return env("META_LOGIN_CONFIG_ID");
}

export function redirectUri(): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return `${base}/instagram/callback`;
}

/** The address of Meta's own login page for this store. */
export function authorizeUrl(shop: string): string {
  const u = new URL(`https://www.facebook.com/${VERSION}/dialog/oauth`);
  u.searchParams.set("client_id", appId());
  u.searchParams.set("config_id", configId());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("state", signState(shop));
  return u.toString();
}

async function fbJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Meta replied unexpectedly (${res.status}).`);
  }
  const err = (data as { error?: { message?: string } }).error;
  if (!res.ok || err) throw new Error(err?.message || `Meta error ${res.status}`);
  return data as T;
}

type PageNode = {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

/** After the merchant clicks Continue/Allow: get tokens, find the linked Instagram account and save it. */
export async function finishLogin(shop: string, rawCode: string) {
  const code = rawCode.replace(/#_$/, "");

  // 1. code → user token
  const ex = new URL(`${GRAPH}/oauth/access_token`);
  ex.searchParams.set("client_id", appId());
  ex.searchParams.set("client_secret", appSecret());
  ex.searchParams.set("redirect_uri", redirectUri());
  ex.searchParams.set("code", code);
  const short = await fbJson<{ access_token: string; expires_in?: number }>(await fetch(ex));

  // 2. short-lived → long-lived user token (Page tokens made from it never expire)
  let userToken = short.access_token;
  try {
    const ll = new URL(`${GRAPH}/oauth/access_token`);
    ll.searchParams.set("grant_type", "fb_exchange_token");
    ll.searchParams.set("client_id", appId());
    ll.searchParams.set("client_secret", appSecret());
    ll.searchParams.set("fb_exchange_token", short.access_token);
    userToken = (await fbJson<{ access_token: string }>(await fetch(ll))).access_token;
  } catch (e) {
    console.warn("Long-lived token exchange failed; using the first token", e);
  }

  // 3. who logged in (for Meta's data-deletion requests)
  const me = await fbJson<{ id: string }>(await fetch(`${GRAPH}/me?fields=id&access_token=${encodeURIComponent(userToken)}`));

  // 4. Pages they manage, with the Instagram account linked to each
  const pagesUrl = new URL(`${GRAPH}/me/accounts`);
  pagesUrl.searchParams.set("fields", "id,name,access_token,instagram_business_account{id,username}");
  pagesUrl.searchParams.set("limit", "100");
  pagesUrl.searchParams.set("access_token", userToken);
  const pages = await fbJson<{ data: PageNode[] }>(await fetch(pagesUrl));
  const page = (pages.data || []).find((p) => p.instagram_business_account?.id);
  if (!page || !page.instagram_business_account) {
    throw new Error(
      "No Instagram Business or Creator account was found. In Instagram, switch to a professional account and link it to your Facebook Page (Instagram → Settings → Accounts Center or Meta Business Suite), then connect again and tick that Page.",
    );
  }
  const ig = page.instagram_business_account;
  const token = page.access_token || userToken;

  let username = ig.username || "";
  if (!username) {
    try {
      username = (await fbJson<{ username: string }>(await fetch(`${GRAPH}/${ig.id}?fields=username&access_token=${encodeURIComponent(token)}`))).username;
    } catch {
      username = page.name;
    }
  }

  const data = {
    igUserId: ig.id,
    fbUserId: me.id,
    pageId: page.id,
    username,
    accountType: "BUSINESS",
    accessToken: encrypt(token),
    // Page tokens from a long-lived user token don't expire; check again in a year.
    tokenExpiresAt: new Date(Date.now() + 365 * 86400 * 1000),
    refreshedAt: new Date(),
  };
  await db.instagramAccount.upsert({ where: { shop }, create: { shop, ...data }, update: { ...data, connectedAt: new Date() } });
  return username;
}

/** Returns the saved token for this store (or null when Instagram isn't connected). */
export async function tokenFor(shop: string): Promise<string | null> {
  const acc = await db.instagramAccount.findUnique({ where: { shop } });
  if (!acc) return null;
  return decrypt(acc.accessToken);
}

type MediaNode = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  timestamp?: string;
};
const FIELDS = "id,caption,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp";

function toReel(m: MediaNode): Reel {
  return {
    id: m.id,
    caption: m.caption ?? null,
    permalink: m.permalink ?? null,
    thumbnail: m.thumbnail_url ?? null,
    mediaUrl: m.media_url ?? null,
    timestamp: m.timestamp ?? null,
    pinned: false,
  };
}

/**
 * Meta's API has no "pinned" field, but pinned posts come first in the profile order.
 * Any of the first 3 posts that is older than a post listed after it must be pinned.
 * (A pinned post that is also the newest can't be told apart, but it is shown first anyway.)
 */
function markPinned(all: MediaNode[]): Set<string> {
  const pinned = new Set<string>();
  const t = (m: MediaNode) => (m.timestamp ? Date.parse(m.timestamp) : 0);
  for (let i = 0; i < Math.min(3, all.length); i++) {
    const mine = t(all[i]);
    if (!mine) continue;
    for (let j = i + 1; j < all.length; j++) {
      if (t(all[j]) > mine) {
        pinned.add(all[i].id);
        break;
      }
    }
  }
  return pinned;
}

function isReel(m: MediaNode) {
  return m.media_type === "VIDEO" || m.media_product_type === "REELS";
}

function friendly(e: unknown): Error {
  const msg = e instanceof Error ? e.message : String(e);
  if (/session has expired|validating access token|has not authorized|Error validating/i.test(msg)) {
    return new Error("The Instagram connection has expired or was removed. Please click Reconnect.");
  }
  return e instanceof Error ? e : new Error(msg);
}

/** The account's reels (videos) in profile order: pinned first, then newest first. */
export async function listReels(shop: string, max = 60): Promise<Reel[]> {
  const acc = await db.instagramAccount.findUnique({ where: { shop } });
  if (!acc) return [];
  const token = decrypt(acc.accessToken);
  const all: MediaNode[] = [];
  const first = new URL(`${GRAPH}/${acc.igUserId}/media`);
  first.searchParams.set("fields", FIELDS);
  first.searchParams.set("limit", "50");
  first.searchParams.set("access_token", token);
  let next: string | null = first.toString();
  let pages = 0;
  try {
    let videos = 0;
    while (next && videos < max && pages < 6) {
      pages++;
      const page: { data: MediaNode[]; paging?: { next?: string } } = await fbJson(await fetch(next));
      for (const m of page.data || []) {
        all.push(m);
        if (isReel(m)) videos++;
      }
      next = page.paging?.next ?? null;
    }
  } catch (e) {
    throw friendly(e);
  }
  const pinned = markPinned(all);
  return all
    .filter(isReel)
    .map((m) => ({ ...toReel(m), pinned: pinned.has(m.id) }))
    .slice(0, max);
}

/** One reel with a fresh video address (Instagram's addresses expire after a while). */
export async function getReel(shop: string, mediaId: string): Promise<Reel> {
  const token = await tokenFor(shop);
  if (!token) throw new Error("Instagram is not connected.");
  const u = new URL(`${GRAPH}/${encodeURIComponent(mediaId)}`);
  u.searchParams.set("fields", FIELDS);
  u.searchParams.set("access_token", token);
  try {
    return toReel(await fbJson<MediaNode>(await fetch(u)));
  } catch (e) {
    throw friendly(e);
  }
}

export async function disconnect(shop: string) {
  await db.instagramAccount.deleteMany({ where: { shop } });
}
