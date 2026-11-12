import db from "../db.server";
import { decrypt, encrypt, signState } from "./crypto.server";

/**
 * Instagram API with Instagram Login (professional accounts: Business or Creator).
 * Docs: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login
 */
const GRAPH = "https://graph.instagram.com";
const VERSION = process.env.IG_GRAPH_VERSION || "v23.0";
const SCOPES = ["instagram_business_basic"];

export type Reel = {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnail: string | null;
  mediaUrl: string | null;
  timestamp: string | null;
};

function appId(): string {
  const v = process.env.INSTAGRAM_APP_ID;
  if (!v) throw new Error("INSTAGRAM_APP_ID is missing. Add it in Render → Environment.");
  return v;
}
function appSecret(): string {
  const v = process.env.INSTAGRAM_APP_SECRET;
  if (!v) throw new Error("INSTAGRAM_APP_SECRET is missing. Add it in Render → Environment.");
  return v;
}
export function redirectUri(): string {
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return `${base}/instagram/callback`;
}

/** The address of Instagram's own login page for this store. */
export function authorizeUrl(shop: string): string {
  const u = new URL("https://www.instagram.com/oauth/authorize");
  u.searchParams.set("enable_fb_login", "0");
  u.searchParams.set("force_authentication", "1");
  u.searchParams.set("client_id", appId());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", SCOPES.join(","));
  u.searchParams.set("state", signState(shop));
  return u.toString();
}

async function igJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Instagram replied unexpectedly (${res.status}).`);
  }
  const err = (data as { error?: { message?: string } | string; error_message?: string }) || {};
  if (!res.ok || err.error) {
    const msg =
      typeof err.error === "object" ? err.error?.message : err.error_message || (typeof err.error === "string" ? err.error : "");
    throw new Error(msg || `Instagram error ${res.status}`);
  }
  return data as T;
}

/** After the merchant clicks Allow: turn the one-time code into a 60-day token and save it. */
export async function finishLogin(shop: string, rawCode: string) {
  const code = rawCode.replace(/#_$/, "");
  const form = new URLSearchParams({
    client_id: appId(),
    client_secret: appSecret(),
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
    code,
  });
  const short = await igJson<{ access_token: string; user_id: number | string }>(
    await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: form }),
  );

  const longUrl = new URL(`${GRAPH}/access_token`);
  longUrl.searchParams.set("grant_type", "ig_exchange_token");
  longUrl.searchParams.set("client_secret", appSecret());
  longUrl.searchParams.set("access_token", short.access_token);
  const long = await igJson<{ access_token: string; expires_in: number }>(await fetch(longUrl));

  const me = await getMe(long.access_token);
  if (me.account_type && !/BUSINESS|MEDIA_CREATOR|CREATOR/i.test(me.account_type)) {
    throw new Error("This Instagram account is a personal account. Switch it to Business or Creator in Instagram settings, then connect again.");
  }

  const data = {
    igUserId: String(me.user_id ?? short.user_id),
    username: me.username,
    accountType: me.account_type ?? null,
    accessToken: encrypt(long.access_token),
    tokenExpiresAt: new Date(Date.now() + (long.expires_in || 60 * 86400) * 1000),
    refreshedAt: new Date(),
  };
  await db.instagramAccount.upsert({ where: { shop }, create: { shop, ...data }, update: { ...data, connectedAt: new Date() } });
  return me.username;
}

async function getMe(token: string) {
  const u = new URL(`${GRAPH}/${VERSION}/me`);
  u.searchParams.set("fields", "user_id,username,account_type");
  u.searchParams.set("access_token", token);
  return igJson<{ user_id?: string; username: string; account_type?: string }>(await fetch(u));
}

/** Returns a working token, refreshing it when it is older than a day and ends within 15 days. */
export async function tokenFor(shop: string): Promise<string | null> {
  const acc = await db.instagramAccount.findUnique({ where: { shop } });
  if (!acc) return null;
  let token = decrypt(acc.accessToken);
  const left = acc.tokenExpiresAt.getTime() - Date.now();
  const age = Date.now() - acc.refreshedAt.getTime();
  if (left <= 0) {
    throw new Error("The Instagram connection has expired. Please connect Instagram again.");
  }
  if (left < 15 * 86400 * 1000 && age > 86400 * 1000) {
    try {
      const u = new URL(`${GRAPH}/refresh_access_token`);
      u.searchParams.set("grant_type", "ig_refresh_token");
      u.searchParams.set("access_token", token);
      const r = await igJson<{ access_token: string; expires_in: number }>(await fetch(u));
      token = r.access_token;
      await db.instagramAccount.update({
        where: { shop },
        data: {
          accessToken: encrypt(token),
          tokenExpiresAt: new Date(Date.now() + r.expires_in * 1000),
          refreshedAt: new Date(),
        },
      });
    } catch (e) {
      console.error("Instagram token refresh failed", e);
    }
  }
  return token;
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
  };
}

/** The account's latest reels (videos), newest first. */
export async function listReels(shop: string, max = 60): Promise<Reel[]> {
  const token = await tokenFor(shop);
  if (!token) return [];
  const out: Reel[] = [];
  let next: string | null = (() => {
    const u = new URL(`${GRAPH}/${VERSION}/me/media`);
    u.searchParams.set("fields", FIELDS);
    u.searchParams.set("limit", "50");
    u.searchParams.set("access_token", token);
    return u.toString();
  })();
  let pages = 0;
  while (next && out.length < max && pages < 6) {
    pages++;
    const page: { data: MediaNode[]; paging?: { next?: string } } = await igJson(await fetch(next));
    for (const m of page.data || []) {
      if (m.media_type === "VIDEO" || m.media_product_type === "REELS") out.push(toReel(m));
    }
    next = page.paging?.next ?? null;
  }
  return out.slice(0, max);
}

/** One reel with a fresh video address (Instagram's addresses expire after a while). */
export async function getReel(shop: string, mediaId: string): Promise<Reel> {
  const token = await tokenFor(shop);
  if (!token) throw new Error("Instagram is not connected.");
  const u = new URL(`${GRAPH}/${VERSION}/${encodeURIComponent(mediaId)}`);
  u.searchParams.set("fields", FIELDS);
  u.searchParams.set("access_token", token);
  return toReel(await igJson<MediaNode>(await fetch(u)));
}

export async function disconnect(shop: string) {
  await db.instagramAccount.deleteMany({ where: { shop } });
}
