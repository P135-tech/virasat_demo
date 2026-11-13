import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { forgetShop } from "../lib/listings.server";

/**
 * Mandatory privacy webhooks for App Store apps.
 * This version stores no customer data, so customer requests need no action.
 * shop/redact (48 hours after uninstall): remove everything kept for that store.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);
  if (topic === "SHOP_REDACT") {
    await forgetShop(shop);
    await db.session.deleteMany({ where: { shop } });
  }
  return new Response();
};
