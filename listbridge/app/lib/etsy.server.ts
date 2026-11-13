import { createHash, randomBytes } from "crypto";
import db from "../db.server";
import { decrypt, encrypt } from "./crypto.server";

/**
 * Etsy Open API v3.
 * - Login: OAuth 2.0 Authorization Code with PKCE (required by Etsy on every login).
 * - Every request sends x-api-key: "<keystring>:<shared secret>".
 * - Access tokens last 1 hour, refresh tokens 90 days; we refresh automatically.
 */
const API = "https://api.etsy.com/v3/application";
const TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";
const CONNECT_URL = "https://www.etsy.com/oauth/connect";

// Only what this version needs: read/create listings and read the shop's settings.
export const SCOPES = ["listings_r", "listings_w", "shops_r"];

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is missing. Add it in Render → Environment.`);
  return v;
}
const keystring = () => env("ETSY_API_KEY");
const apiKeyHeader = () => `${keystring()}:${env("ETSY_SHARED_SECRET")}`;
export const redirectUri = () => `${env("SHOPIFY_APP_URL").replace(/\/$/, "")}/etsy/callback`;

export class EtsyError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function readError(res: Response) {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j.error_description || j.error || j.message || text;
  } catch {
    return text.slice(0, 300);
  }
}

// ---------- Login (OAuth 2.0 + PKCE) ----------

/** Creates a login link for this store. The PKCE verifier is kept in our database until Etsy sends the merchant back. */
export async function startLogin(shop: string) {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url"); // 64 chars, allowed characters only
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  await db.etsyAuthState.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 60 * 1000) } } });
  await db.etsyAuthState.create({ data: { state, shop, verifier } });
  const u = new URL(CONNECT_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", keystring());
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("scope", SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

type TokenReply = { access_token: string; refresh_token: string; expires_in: number };

async function tokenRequest(body: Record<string, string>): Promise<TokenReply> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new EtsyError(`Etsy login failed: ${await readError(res)}`, res.status);
  return (await res.json()) as TokenReply;
}

/** Finishes the login: swaps the code for tokens, reads the merchant's Etsy shop and saves everything (encrypted). */
export async function finishLogin(state: string, code: string) {
  const pending = await db.etsyAuthState.findUnique({ where: { state } });
  if (!pending || Date.now() - pending.createdAt.getTime() > 30 * 60 * 1000) {
    throw new Error("This Etsy login link has expired. Please go back to the app and click Connect Etsy again.");
  }
  await db.etsyAuthState.delete({ where: { state } });

  const t = await tokenRequest({
    grant_type: "authorization_code",
    client_id: keystring(),
    redirect_uri: redirectUri(),
    code,
    code_verifier: pending.verifier,
  });

  const me = await rawGet<{ user_id: number; shop_id?: number }>("/users/me", t.access_token);
  if (!me.shop_id) {
    throw new Error("This Etsy account has no shop. Log in with the Etsy account that owns your shop.");
  }
  const shopInfo = await rawGet<{ shop_name: string; currency_code: string }>(`/shops/${me.shop_id}`, t.access_token);

  const data = {
    etsyUserId: String(me.user_id),
    etsyShopId: String(me.shop_id),
    etsyShopName: shopInfo.shop_name,
    currency: shopInfo.currency_code,
    accessToken: encrypt(t.access_token),
    refreshToken: encrypt(t.refresh_token),
    expiresAt: new Date(Date.now() + t.expires_in * 1000),
    connectedAt: new Date(),
    installId: null,
  };
  await db.etsyConnection.upsert({ where: { shop: pending.shop }, create: { shop: pending.shop, ...data }, update: data });
  return pending.shop;
}

export async function disconnect(shop: string) {
  await db.etsyConnection.deleteMany({ where: { shop } });
}

/** A valid access token for the store's Etsy shop (refreshed when it is about to expire). */
async function tokenFor(shop: string): Promise<{ token: string; etsyShopId: string }> {
  const c = await db.etsyConnection.findUnique({ where: { shop } });
  if (!c) throw new Error("Etsy is not connected.");
  if (c.expiresAt.getTime() - Date.now() > 60 * 1000) return { token: decrypt(c.accessToken), etsyShopId: c.etsyShopId };
  let t: TokenReply;
  try {
    t = await tokenRequest({ grant_type: "refresh_token", client_id: keystring(), refresh_token: decrypt(c.refreshToken) });
  } catch {
    throw new Error("Your Etsy login has expired. Please click Reconnect Etsy.");
  }
  await db.etsyConnection.update({
    where: { shop },
    data: {
      accessToken: encrypt(t.access_token),
      refreshToken: encrypt(t.refresh_token || decrypt(c.refreshToken)),
      expiresAt: new Date(Date.now() + t.expires_in * 1000),
    },
  });
  return { token: t.access_token, etsyShopId: c.etsyShopId };
}

// ---------- API calls ----------

async function rawGet<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { "x-api-key": apiKeyHeader(), Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new EtsyError(`Etsy: ${await readError(res)}`, res.status);
  return (await res.json()) as T;
}

/** Calls the Etsy API for a store. path may contain {shop_id}. */
export async function etsy<T>(
  shop: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: { form?: Record<string, string>; json?: unknown; multipart?: FormData },
): Promise<T> {
  const { token, etsyShopId } = await tokenFor(shop);
  const headers: Record<string, string> = { "x-api-key": apiKeyHeader(), Authorization: `Bearer ${token}` };
  let payload: BodyInit | undefined;
  if (body?.form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body.form);
  } else if (body?.json !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body.json);
  } else if (body?.multipart) {
    payload = body.multipart; // fetch sets the multipart boundary itself
  }
  const url = `${API}${path.replace("{shop_id}", etsyShopId)}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { method, headers, body: payload });
    if (res.status === 429 && attempt < 3) {
      // Etsy rate limit: wait and try again.
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      continue;
    }
    if (!res.ok) throw new EtsyError(`Etsy: ${await readError(res)}`, res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

// ---------- Shop settings the merchant picks from ----------

export type Option = { id: string; label: string };

export async function shippingProfiles(shop: string): Promise<Option[]> {
  const r = await etsy<{ results: { shipping_profile_id: number; title: string }[] }>(shop, "GET", "/shops/{shop_id}/shipping-profiles");
  return r.results.map((p) => ({ id: String(p.shipping_profile_id), label: p.title }));
}

export async function processingProfiles(shop: string): Promise<Option[]> {
  const r = await etsy<{
    results: {
      readiness_state_id: number;
      readiness_state: string;
      min_processing_time: number;
      max_processing_time: number;
      processing_time_unit?: string;
    }[];
  }>(shop, "GET", "/shops/{shop_id}/readiness-state-definitions");
  return r.results.map((p) => ({
    id: String(p.readiness_state_id),
    label: `${p.readiness_state === "made_to_order" ? "Made to order" : "Ready to ship"}: ${p.min_processing_time}–${p.max_processing_time} ${p.processing_time_unit || "days"}`,
  }));
}

export async function returnPolicies(shop: string): Promise<Option[]> {
  const r = await etsy<{
    results: { return_policy_id: number; accepts_returns: boolean; accepts_exchanges: boolean; return_deadline: number | null }[];
  }>(shop, "GET", "/shops/{shop_id}/policies/return");
  return r.results.map((p) => ({
    id: String(p.return_policy_id),
    label:
      p.accepts_returns || p.accepts_exchanges
        ? `${[p.accepts_returns && "Returns", p.accepts_exchanges && "Exchanges"].filter(Boolean).join(" and ")} within ${p.return_deadline ?? "?"} days`
        : "No returns or exchanges",
  }));
}

/** Etsy's category list, flattened to "Clothing › Women's Clothing › …" (cached for a day). */
type Node = { id: number; name: string; children?: Node[] };
let taxonomyCache: { at: number; list: { id: number; path: string }[] } | null = null;
export async function categories(shop: string) {
  if (taxonomyCache && Date.now() - taxonomyCache.at < 24 * 3600 * 1000) return taxonomyCache.list;
  const r = await etsy<{ results: Node[] }>(shop, "GET", "/seller-taxonomy/nodes");
  const list: { id: number; path: string }[] = [];
  const walk = (n: Node, trail: string[]) => {
    const path = [...trail, n.name];
    if (!n.children || n.children.length === 0) list.push({ id: n.id, path: path.join(" › ") });
    n.children?.forEach((c) => walk(c, path));
  };
  r.results.forEach((n) => walk(n, []));
  taxonomyCache = { at: Date.now(), list };
  return list;
}

export function listingEditorUrl(listingId: string) {
  return `https://www.etsy.com/your/shops/me/listing-editor/edit/${listingId}`;
}
