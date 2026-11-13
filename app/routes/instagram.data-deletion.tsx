import type { ActionFunctionArgs } from "react-router";
import { randomBytes } from "crypto";
import db from "../db.server";
import { parseSignedRequest } from "../lib/signed-request.server";
import { removeInstagramReels } from "../lib/reels.server";

/**
 * Meta calls this when an Instagram user asks for their data to be deleted.
 * We delete the saved login and account details at once and reply with a status link + code (Meta's required format).
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const data = parseSignedRequest(String(form.get("signed_request") || ""));
  if (!data?.user_id) return new Response("Bad request", { status: 400 });
  const accounts = await db.instagramAccount.findMany({ where: { OR: [{ fbUserId: String(data.user_id) }, { igUserId: String(data.user_id) }] } });
  await db.instagramAccount.deleteMany({ where: { OR: [{ fbUserId: String(data.user_id) }, { igUserId: String(data.user_id) }] } });
  for (const a of accounts) await removeInstagramReels(a.shop, { everything: true });
  const code = randomBytes(8).toString("hex");
  const base = (process.env.SHOPIFY_APP_URL || "").replace(/\/$/, "");
  return Response.json({ url: `${base}/privacy#deleted-${code}`, confirmation_code: code });
};

export const loader = () => new Response("Method not allowed", { status: 405 });
