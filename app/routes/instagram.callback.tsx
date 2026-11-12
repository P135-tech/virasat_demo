import type { LoaderFunctionArgs } from "react-router";
import { redirect, useLoaderData } from "react-router";
import { verifyState } from "../lib/crypto.server";
import { finishLogin } from "../lib/instagram.server";

/** Instagram sends the merchant back here after they click Allow (or Cancel). */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  let shop = "";
  try {
    shop = verifyState(url.searchParams.get("state") || "");
    const denied = url.searchParams.get("error");
    if (denied) {
      return { ok: false, shop, message: "Instagram was not connected because the permission was cancelled." };
    }
    const code = url.searchParams.get("code");
    if (!code) return { ok: false, shop, message: "Instagram did not send a login code. Please try again." };
    await finishLogin(shop, code);
  } catch (e) {
    return { ok: false, shop, message: e instanceof Error ? e.message : String(e) };
  }
  throw redirect(adminAppUrl(shop, "connected=1"));
};

function adminAppUrl(shop: string, query = "") {
  const store = shop.replace(/\.myshopify\.com$/, "");
  const key = process.env.SHOPIFY_API_KEY || "";
  return `https://admin.shopify.com/store/${store}/apps/${key}${query ? `?${query}` : ""}`;
}

export default function InstagramCallback() {
  const d = useLoaderData<typeof loader>();
  const store = d.shop ? d.shop.replace(/\.myshopify\.com$/, "") : "";
  return (
    <div style={{ maxWidth: 520, margin: "80px auto", padding: 24, fontFamily: "system-ui, sans-serif", lineHeight: 1.5 }}>
      <h1 style={{ fontSize: 22 }}>Instagram not connected</h1>
      <p>{d.message}</p>
      {store ? (
        <p>
          <a href={`https://admin.shopify.com/store/${store}/apps`}>Back to your Shopify apps</a>
        </p>
      ) : null}
    </div>
  );
}
