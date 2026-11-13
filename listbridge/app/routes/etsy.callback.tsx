import type { LoaderFunctionArgs } from "react-router";
import { finishLogin } from "../lib/etsy.server";

/** Etsy sends the merchant back here after they approve (or cancel) the connection. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code");
  const denied = url.searchParams.get("error");
  let message = "";
  if (denied || !code) {
    message = "The Etsy connection was cancelled. Go back to the app and click Connect Etsy to try again.";
  } else {
    try {
      const shop = await finishLogin(state, code);
      const store = shop.replace(".myshopify.com", "");
      return Response.redirect(`https://admin.shopify.com/store/${store}/apps/${process.env.SHOPIFY_API_KEY}?connected=1`, 302);
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
  }
  const safe = message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
  return new Response(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>ListBridge</title>
<div style="max-width:560px;margin:15vh auto;padding:0 20px;font-family:system-ui,sans-serif;line-height:1.6">
<h1 style="font-size:24px">Etsy not connected</h1><p>${safe}</p>
<p><a href="https://admin.shopify.com/">Back to your Shopify admin</a></p></div>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
};
