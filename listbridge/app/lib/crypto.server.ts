import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

/** 32-byte key from TOKEN_ENCRYPTION_KEY (any long random string). */
function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw || raw.length < 16) {
    throw new Error("TOKEN_ENCRYPTION_KEY is missing. Add a long random value in Render → Environment.");
  }
  return createHash("sha256").update(raw).digest();
}

/** Encrypts a secret (the Etsy tokens) before it is saved in the database. */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), data.toString("base64url")].join(".");
}

export function decrypt(stored: string): string {
  const [v, iv, tag, data] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Saved Etsy login is unreadable. Please connect again.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}

function stateSecret(): string {
  const s = process.env.SHOPIFY_API_SECRET;
  if (!s) throw new Error("SHOPIFY_API_SECRET is missing.");
  return s;
}

/** Signed, short-lived "state" for the Etsy login, so the reply can only belong to this store. */
export function signState(shop: string): string {
  const body = Buffer.from(JSON.stringify({ shop, ts: Date.now(), n: randomBytes(8).toString("hex") })).toString("base64url");
  const sig = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyState(state: string, maxAgeMs = 20 * 60 * 1000): string {
  const [body, sig] = (state || "").split(".");
  if (!body || !sig) throw new Error("Instagram login link is not valid. Please try again from the app.");
  const expected = createHmac("sha256", stateSecret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error("Instagram login link is not valid. Please try again from the app.");
  }
  const { shop, ts } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { shop: string; ts: number };
  if (!shop || Date.now() - ts > maxAgeMs) throw new Error("The Instagram login took too long. Please try again from the app.");
  return shop;
}
