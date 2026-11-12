import { createHmac, timingSafeEqual } from "crypto";

/** Reads Meta's signed_request (used by the deauthorize and data-deletion callbacks). */
export function parseSignedRequest(signed: string): { user_id?: string; algorithm?: string } | null {
  const secret = process.env.META_APP_SECRET || process.env.INSTAGRAM_APP_SECRET;
  if (!secret || !signed) return null;
  const [sig, payload] = signed.split(".");
  if (!sig || !payload) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(sig.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}
