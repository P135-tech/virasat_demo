import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { parseSignedRequest } from "../lib/signed-request.server";
import { removeInstagramReels } from "../lib/reels.server";

/** Meta calls this when someone removes ReelStage from their Facebook or Instagram account. */
export const action = async ({ request }: ActionFunctionArgs) => {
  const form = await request.formData();
  const data = parseSignedRequest(String(form.get("signed_request") || ""));
  if (!data?.user_id) return new Response("Bad request", { status: 400 });
  const where = { OR: [{ fbUserId: String(data.user_id) }, { igUserId: String(data.user_id) }] };
  const accounts = await db.instagramAccount.findMany({ where });
  await db.instagramAccount.deleteMany({ where });
  for (const acc of accounts) await removeInstagramReels(acc.shop);
  return new Response("OK");
};

export const loader = () => new Response("Method not allowed", { status: 405 });
