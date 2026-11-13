import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Forget the Etsy login and settings. Listings already created on Etsy stay there (they belong to the merchant).
  // A late message must not wipe a newer install: only remove what was saved before the uninstall.
  const at = Date.parse(request.headers.get("x-shopify-triggered-at") || "");
  const before = Number.isNaN(at) ? new Date() : new Date(at);
  await db.etsyConnection.deleteMany({ where: { shop, connectedAt: { lt: before } } });
  await db.etsyAuthState.deleteMany({ where: { shop } });
  await db.listingLink.deleteMany({ where: { shop, createdAt: { lt: before } } });
  await db.listingDefaults.deleteMany({ where: { shop } });

  return new Response();
};
