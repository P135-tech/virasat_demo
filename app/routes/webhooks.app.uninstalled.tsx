import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhooks can arrive more than once, and after the app is already gone.
  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }
  // Forget the merchant's Instagram login straight away. The reels already copied
  // into the store's Shopify Files stay there (they belong to the merchant).
  await db.instagramAccount.deleteMany({ where: { shop } });
  await db.selectedReel.deleteMany({ where: { shop } });
  await db.reelSettings.deleteMany({ where: { shop } });

  return new Response();
};
