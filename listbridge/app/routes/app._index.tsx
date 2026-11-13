import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { categories, disconnect, processingProfiles, returnPolicies, shippingProfiles, startLogin, type Option } from "../lib/etsy.server";
import { forgetOldInstall, getDefaults, missingDefaults, type Admin } from "../lib/listings.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  try {
    await forgetOldInstall(admin as unknown as Admin, shop);
  } catch (e) {
    console.error("forgetOldInstall", e);
  }

  const conn = await db.etsyConnection.findUnique({ where: { shop } });
  const shopify = (await (
    await admin.graphql(`#graphql
      query { shop { currencyCode } }`)
  ).json()) as { data: { shop: { currencyCode: string } } };
  const shopifyCurrency = shopify.data.shop.currencyCode;

  let options = { shipping: [] as Option[], processing: [] as Option[], returns: [] as Option[], categories: [] as { id: number; path: string }[] };
  let etsyError: string | null = null;
  if (conn) {
    try {
      const [shipping, processing, returns, cats] = await Promise.all([
        shippingProfiles(shop),
        processingProfiles(shop),
        returnPolicies(shop).catch(() => [] as Option[]),
        categories(shop),
      ]);
      options = { shipping, processing, returns, categories: cats };
    } catch (e) {
      etsyError = e instanceof Error ? e.message : String(e);
    }
  }
  const defaults = await getDefaults(shop);

  return {
    connected: conn ? { shopName: conn.etsyShopName, currency: conn.currency } : null,
    justConnected: url.searchParams.get("connected") === "1",
    shopifyCurrency,
    etsyError,
    options,
    defaults,
    missing: missingDefaults(defaults),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  try {
    if (intent === "connect") {
      return { ok: true, redirectTo: await startLogin(shop) };
    }
    if (intent === "disconnect") {
      await disconnect(shop);
      return { ok: true, message: "Etsy disconnected. Listings already on Etsy stay there." };
    }
    if (intent === "defaults") {
      const num = (k: string, fallback: number) => {
        const n = Number(String(fd.get(k) ?? "").replace(",", "."));
        return Number.isFinite(n) ? n : fallback;
      };
      const str = (k: string) => {
        const v = String(fd.get(k) ?? "").trim();
        return v || null;
      };
      const taxonomyId = str("taxonomyId") ? Number(fd.get("taxonomyId")) : null;
      const data = {
        taxonomyId,
        taxonomyPath: str("taxonomyPath"),
        whoMade: ["i_did", "someone_else", "collective"].includes(String(fd.get("whoMade"))) ? String(fd.get("whoMade")) : "someone_else",
        whenMade: str("whenMade") || "made_to_order",
        shippingProfileId: str("shippingProfileId"),
        readinessStateId: str("readinessStateId"),
        returnPolicyId: str("returnPolicyId"),
        exchangeRate: Math.max(0, num("exchangeRate", 1)),
        markupPercent: Math.min(500, Math.max(-90, num("markupPercent", 0))),
      };
      await db.listingDefaults.upsert({ where: { shop }, create: { shop, ...data }, update: data });
      return { ok: true, message: "Etsy listing settings saved." };
    }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, message: "Unknown action" };
};

const field: CSSProperties = { display: "grid", gap: 6 };
const input: CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid #c9c9c9", font: "inherit", width: "100%", boxSizing: "border-box" };
const hint: CSSProperties = { color: "#616161", fontSize: 12 };

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const busy = nav.state !== "idle";

  useEffect(() => {
    if (result && "redirectTo" in result && result.redirectTo) {
      window.open(result.redirectTo, "_top");
      return;
    }
    if (result && "message" in result && result.message) shopify.toast.show(result.message, { isError: !result.ok });
  }, [result, shopify]);
  useEffect(() => {
    if (d.justConnected) shopify.toast.show("Etsy connected");
  }, [d.justConnected, shopify]);

  const post = (data: Record<string, string>) => {
    const fd = new FormData();
    Object.entries(data).forEach(([k, v]) => fd.append(k, v));
    submit(fd, { method: "post" });
  };

  // Settings form state
  const [f, setF] = useState({
    taxonomyId: d.defaults.taxonomyId ? String(d.defaults.taxonomyId) : "",
    taxonomyPath: d.defaults.taxonomyPath || "",
    whoMade: d.defaults.whoMade,
    whenMade: d.defaults.whenMade,
    shippingProfileId: d.defaults.shippingProfileId || "",
    readinessStateId: d.defaults.readinessStateId || "",
    returnPolicyId: d.defaults.returnPolicyId || "",
    exchangeRate: String(d.defaults.exchangeRate),
    markupPercent: String(d.defaults.markupPercent),
  });
  const set = (k: keyof typeof f, v: string) => setF((s) => ({ ...s, [k]: v }));
  const [catSearch, setCatSearch] = useState("");
  const catMatches = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    if (q.length < 2) return [];
    return d.options.categories.filter((c) => c.path.toLowerCase().includes(q)).slice(0, 25);
  }, [catSearch, d.options.categories]);

  if (!d.connected) {
    return (
      <s-page heading="ListBridge">
        <s-section heading="Connect your Etsy shop">
          <s-stack gap="base">
            <s-paragraph>
              Send your Shopify products to your Etsy shop as drafts, with their photos, description, price and stock. You review each
              draft on Etsy and publish it when you’re ready.
            </s-paragraph>
            <s-paragraph>
              You’ll log in on Etsy’s own page. ListBridge never sees your Etsy password, and only gets the access you approve there.
            </s-paragraph>
            <s-stack direction="inline">
              <s-button variant="primary" onClick={() => post({ intent: "connect" })} disabled={busy}>
                Connect Etsy
              </s-button>
            </s-stack>
            <s-text color="subdued">
              The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
            </s-text>
          </s-stack>
        </s-section>
      </s-page>
    );
  }

  const sameCurrency = d.connected.currency === d.shopifyCurrency;

  return (
    <s-page heading="ListBridge">
      <s-section heading="Etsy shop">
        <s-stack direction="inline" gap="base">
          <s-paragraph>
            Connected to <s-text type="strong">{d.connected.shopName}</s-text> (prices in {d.connected.currency})
          </s-paragraph>
          <s-button onClick={() => post({ intent: "connect" })}>Reconnect Etsy</s-button>
          <s-button tone="critical" onClick={() => post({ intent: "disconnect" })}>
            Disconnect
          </s-button>
        </s-stack>
      </s-section>

      {d.etsyError && (
        <s-section>
          <s-banner tone="critical">{d.etsyError}</s-banner>
        </s-section>
      )}

      <s-section heading="Etsy listing settings">
        <s-stack gap="base">
          <s-paragraph>
            <s-text color="subdued">
              Etsy needs a few details that Shopify doesn’t have. They’re used for every product you send, and you can still change any
              draft on Etsy before publishing.
            </s-text>
          </s-paragraph>
          {d.missing.length > 0 && <s-banner tone="warning">Still needed: {d.missing.join(", ")}.</s-banner>}

          <div style={field}>
            <label htmlFor="cat">
              <b>Etsy category</b>
            </label>
            {f.taxonomyPath && (
              <div style={{ fontSize: 13 }}>
                Selected: <b>{f.taxonomyPath}</b>
              </div>
            )}
            <input id="cat" style={input} placeholder="Search, e.g. saree" value={catSearch} onChange={(e) => setCatSearch(e.currentTarget.value)} />
            {catMatches.length > 0 && (
              <div style={{ border: "1px solid #e3e3e3", borderRadius: 8, maxHeight: 220, overflow: "auto" }}>
                {catMatches.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => {
                      set("taxonomyId", String(c.id));
                      set("taxonomyPath", c.path);
                      setCatSearch("");
                    }}
                    style={{ display: "block", width: "100%", textAlign: "left", padding: "8px 10px", border: 0, borderBottom: "1px solid #f1f1f1", background: "#fff", cursor: "pointer", font: "inherit", fontSize: 13 }}
                  >
                    {c.path}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div style={field}>
              <label htmlFor="who">
                <b>Who made it?</b>
              </label>
              <select id="who" style={input} value={f.whoMade} onChange={(e) => set("whoMade", e.currentTarget.value)}>
                <option value="i_did">I did</option>
                <option value="collective">A member of my shop</option>
                <option value="someone_else">Another company or person</option>
              </select>
              <span style={hint}>Handwoven by partner artisans is usually “Another company or person”.</span>
            </div>
            <div style={field}>
              <label htmlFor="when">
                <b>When was it made?</b>
              </label>
              <input id="when" style={input} value={f.whenMade} onChange={(e) => set("whenMade", e.currentTarget.value)} />
              <span style={hint}>Etsy’s value: “made_to_order”, or a period such as the one Etsy shows for recent items.</span>
            </div>
            <div style={field}>
              <label htmlFor="ship">
                <b>Shipping profile</b>
              </label>
              <select id="ship" style={input} value={f.shippingProfileId} onChange={(e) => set("shippingProfileId", e.currentTarget.value)}>
                <option value="">Choose…</option>
                {d.options.shipping.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {d.options.shipping.length === 0 && <span style={hint}>No shipping profiles found. Create one on Etsy first.</span>}
            </div>
            <div style={field}>
              <label htmlFor="proc">
                <b>Processing profile</b>
              </label>
              <select id="proc" style={input} value={f.readinessStateId} onChange={(e) => set("readinessStateId", e.currentTarget.value)}>
                <option value="">Choose…</option>
                {d.options.processing.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              {d.options.processing.length === 0 && <span style={hint}>No processing profiles found. Create one on Etsy first.</span>}
            </div>
            <div style={field}>
              <label htmlFor="ret">
                <b>Return policy</b> (optional)
              </label>
              <select id="ret" style={input} value={f.returnPolicyId} onChange={(e) => set("returnPolicyId", e.currentTarget.value)}>
                <option value="">Etsy shop default</option>
                {d.options.returns.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
            <div style={field}>
              <label htmlFor="rate">
                <b>
                  Exchange rate: 1 {d.shopifyCurrency} = ? {d.connected.currency}
                </b>
              </label>
              <input id="rate" style={input} inputMode="decimal" value={f.exchangeRate} onChange={(e) => set("exchangeRate", e.currentTarget.value)} />
              <span style={hint}>{sameCurrency ? "Both shops use the same currency, so keep 1." : "Prices are converted with this rate when you send a product."}</span>
            </div>
            <div style={field}>
              <label htmlFor="markup">
                <b>Price adjustment on Etsy (%)</b>
              </label>
              <input id="markup" style={input} inputMode="decimal" value={f.markupPercent} onChange={(e) => set("markupPercent", e.currentTarget.value)} />
              <span style={hint}>For example 10 adds 10% to cover Etsy fees. 0 keeps the Shopify price.</span>
            </div>
          </div>

          <s-stack direction="inline" gap="base">
            <s-button variant="primary" disabled={busy} onClick={() => post({ intent: "defaults", ...f })}>
              Save settings
            </s-button>
            <s-link href="/app/products">Go to products →</s-link>
          </s-stack>
        </s-stack>
      </s-section>

      <s-section>
        <s-text color="subdued">
          The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
        </s-text>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
