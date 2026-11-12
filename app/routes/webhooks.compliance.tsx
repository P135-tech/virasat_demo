import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

/**
 * Mandatory privacy webhooks for App Store apps.
 * The app stores no customer data at all, so customer requests need no action.
 * shop/redact (48 hours after uninstall): remove everything kept for that store.
 */
export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  switch (topic) {
    case "CUSTOMERS_DATA_REQUEST":
    case "CUSTOMERS_REDACT":
      // No customer data is stored by this app.
      break;
    case "SHOP_REDACT":
      await db.instagramAccount.deleteMany({ where: { shop } });
      await db.selectedReel.deleteMany({ where: { shop } });
      await db.reelSettings.deleteMany({ where: { shop } });
      await db.session.deleteMany({ where: { shop } });
      break;
    default:
      break;
  }
  return new Response();
};
