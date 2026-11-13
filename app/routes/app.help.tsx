import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return { shop: session.shop, apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function Help() {
  const { shop, apiKey } = useLoaderData<typeof loader>();
  const home = `https://${shop}/admin/themes/current/editor?template=index&addAppBlockId=${apiKey}/reels&target=newAppsSection`;
  const product = `https://${shop}/admin/themes/current/editor?template=product&addAppBlockId=${apiKey}/reels&target=newAppsSection`;
  return (
    <s-page heading="How to show reels on your store">
      <s-section heading="1. Choose your reels">
        <s-paragraph>
          On the Reels page, connect Instagram, tick the reels you want and click Save. By default the reels play straight from
          Instagram, and ReelStage keeps their links up to date. If you prefer, choose “Copy to Shopify Files” on the Reels page
          to keep a copy of each reel in your store’s Files (Content → Files).
        </s-paragraph>
      </s-section>
      <s-section heading="2. Add the block to a page">
        <s-stack gap="base">
          <s-paragraph>The “ReelStage reels” block works in any Online Store 2.0 theme. Add it where you want:</s-paragraph>
          <s-stack direction="inline" gap="base">
            <s-button href={home} target="_blank">Add to home page</s-button>
            <s-button href={product} target="_blank">Add to product pages</s-button>
          </s-stack>
          <s-paragraph>
            In the theme editor you can change the heading, card size, rounded corners, and whether videos play by themselves
            (muted) or only when tapped. Click Save in the theme editor when done.
          </s-paragraph>
        </s-stack>
      </s-section>
      <s-section heading="Good to know">
        <s-unordered-list>
          <s-list-item>Up to 20 reels can be shown. Change the order with the arrows on the Reels page.</s-list-item>
          <s-list-item>Your Instagram must be a Business or Creator account linked to a Facebook Page (a Meta rule).</s-list-item>
          <s-list-item>Disconnecting Instagram removes reels played from Instagram from your store. Reels copied to Shopify Files stay until you remove them.</s-list-item>
          <s-list-item>The app only reads your posts. It never posts, comments or changes anything on Instagram.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
