import { useEffect, useState, type CSSProperties } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useActionData, useLoaderData, useNavigation, useRevalidator, useSearchParams, useSubmit } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { listingEditorUrl } from "../lib/etsy.server";
import { getDefaults, missingDefaults, queueProducts, resumeQueue } from "../lib/listings.server";

type ProductRow = {
  id: string;
  title: string;
  status: string;
  totalInventory: number | null;
  variantsCount: { count: number };
  featuredMedia: { preview: { image: { url: string } | null } | null } | null;
  priceRangeV2: { minVariantPrice: { amount: string; currencyCode: string } };
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const after = url.searchParams.get("after");
  const before = url.searchParams.get("before");

  const res = await admin.graphql(
    `#graphql
    query Products($first: Int, $last: Int, $after: String, $before: String, $query: String) {
      products(first: $first, last: $last, after: $after, before: $before, query: $query, sortKey: UPDATED_AT, reverse: true) {
        nodes {
          id title status totalInventory
          variantsCount { count }
          featuredMedia { preview { image { url(transform: { maxWidth: 160 }) } } }
          priceRangeV2 { minVariantPrice { amount currencyCode } }
        }
        pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      }
    }`,
    {
      variables: {
        ...(before ? { last: 25, before } : { first: 25, after }),
        query: q ? `title:*${q.replace(/[*"\\]/g, "")}*` : null,
      },
    },
  );
  const json = (await res.json()) as {
    data: { products: { nodes: ProductRow[]; pageInfo: { hasNextPage: boolean; hasPreviousPage: boolean; startCursor: string; endCursor: string } } };
  };
  const products = json.data.products;
  const links = await db.listingLink.findMany({ where: { shop, shopifyProductId: { in: products.nodes.map((p) => p.id) } } });
  await resumeQueue(shop);

  const conn = await db.etsyConnection.findUnique({ where: { shop } });
  const defaults = await getDefaults(shop);
  return {
    connected: !!conn,
    missing: missingDefaults(defaults),
    q,
    pageInfo: products.pageInfo,
    products: products.nodes.map((p) => {
      const l = links.find((x) => x.shopifyProductId === p.id);
      return {
        id: p.id,
        title: p.title,
        shopifyStatus: p.status,
        stock: p.totalInventory,
        variants: p.variantsCount.count,
        image: p.featuredMedia?.preview?.image?.url ?? null,
        price: `${p.priceRangeV2.minVariantPrice.amount} ${p.priceRangeV2.minVariantPrice.currencyCode}`,
        etsy: l ? { status: l.status, error: l.error, url: l.etsyListingId ? listingEditorUrl(l.etsyListingId) : null } : null,
      };
    }),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  const fd = await request.formData();
  const items = JSON.parse(String(fd.get("items") || "[]")) as { id: string; title: string }[];
  if (!items.length) return { ok: false, message: "Tick at least one product." };
  const missing = missingDefaults(await getDefaults(shop));
  if (missing.length) return { ok: false, message: `Finish the Etsy listing settings first: ${missing.join(", ")}.` };
  const added = await queueProducts(shop, items.slice(0, 50));
  return {
    ok: true,
    message: added ? `Sending ${added} product${added === 1 ? "" : "s"} to Etsy as drafts…` : "Those products are already on Etsy.",
  };
};

const thumb: CSSProperties = { width: 48, height: 48, borderRadius: 6, objectFit: "cover", background: "#f1f1f1", flex: "0 0 auto" };

export default function Products() {
  const d = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const nav = useNavigation();
  const submit = useSubmit();
  const revalidator = useRevalidator();
  const shopify = useAppBridge();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(d.q);
  const [picked, setPicked] = useState<string[]>([]);
  const busy = nav.state !== "idle";

  useEffect(() => {
    if (result?.message) shopify.toast.show(result.message, { isError: !result.ok });
    if (result?.ok) setPicked([]);
  }, [result, shopify]);

  const working = d.products.some((p) => p.etsy && (p.etsy.status === "queued" || p.etsy.status === "sending"));
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => revalidator.state === "idle" && revalidator.revalidate(), 4000);
    return () => clearInterval(t);
  }, [working, revalidator]);

  if (!d.connected) {
    return (
      <s-page heading="Products">
        <s-section>
          <s-paragraph>
            Connect your Etsy shop first on the <s-link href="/app">ListBridge</s-link> page.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  const canSend = (p: (typeof d.products)[number]) => !p.etsy?.url && p.variants <= 1 && (p.stock ?? 0) > 0;
  const toggle = (id: string) => setPicked((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const send = () => {
    const items = d.products.filter((p) => picked.includes(p.id)).map((p) => ({ id: p.id, title: p.title }));
    const fd = new FormData();
    fd.append("items", JSON.stringify(items));
    submit(fd, { method: "post" });
  };

  return (
    <s-page heading="Products">
      <s-section>
        <s-stack gap="base">
          {d.missing.length > 0 && (
            <s-banner tone="warning">
              Before sending, finish the <s-link href="/app">Etsy listing settings</s-link>: {d.missing.join(", ")}.
            </s-banner>
          )}
          <s-paragraph>
            <s-text color="subdued">
              Tick products and click “Send to Etsy as drafts”. Drafts are free. Open each one on Etsy to check it, then publish it there
              (Etsy charges its normal listing fee when you publish).
            </s-text>
          </s-paragraph>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = new URLSearchParams();
              if (search.trim()) next.set("q", search.trim());
              setParams(next);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              value={search}
              onChange={(e) => setSearch(e.currentTarget.value)}
              placeholder="Search products by title"
              style={{ flex: 1, padding: "8px 10px", borderRadius: 8, border: "1px solid #c9c9c9", font: "inherit" }}
            />
            <button type="submit" style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #c9c9c9", background: "#fff", font: "inherit", cursor: "pointer" }}>
              Search
            </button>
          </form>

          <div style={{ border: "1px solid #e3e3e3", borderRadius: 12, overflow: "hidden" }}>
            {d.products.length === 0 && <div style={{ padding: 16 }}>No products found.</div>}
            {d.products.map((p) => {
              const sendable = canSend(p);
              const why = p.etsy?.url ? null : p.variants > 1 ? "Has several variants (not supported yet)" : (p.stock ?? 0) <= 0 ? "Out of stock" : null;
              return (
                <label
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid #f1f1f1", cursor: sendable ? "pointer" : "default", background: picked.includes(p.id) ? "#f6f6f7" : "#fff" }}
                >
                  <input type="checkbox" disabled={!sendable} checked={picked.includes(p.id)} onChange={() => toggle(p.id)} />
                  {p.image ? <img src={p.image} alt="" style={thumb} /> : <div style={thumb} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.title}</div>
                    <div style={{ color: "#616161", fontSize: 12 }}>
                      {p.price} · Stock {p.stock ?? "–"}
                      {p.shopifyStatus !== "ACTIVE" ? ` · ${p.shopifyStatus.toLowerCase()} in Shopify` : ""}
                    </div>
                    {why && <div style={{ color: "#8a6116", fontSize: 12 }}>{why}</div>}
                    {p.etsy?.error && <div style={{ color: p.etsy.status === "failed" ? "#8e1f0b" : "#8a6116", fontSize: 12 }}>{p.etsy.error}</div>}
                  </div>
                  <div style={{ flex: "0 0 auto", textAlign: "right" }}>
                    {!p.etsy && <s-badge>Not on Etsy</s-badge>}
                    {p.etsy?.status === "queued" && <s-badge tone="info">Waiting…</s-badge>}
                    {p.etsy?.status === "sending" && <s-badge tone="info">Sending…</s-badge>}
                    {p.etsy?.status === "failed" && <s-badge tone="critical">Failed</s-badge>}
                    {p.etsy?.status === "draft" && <s-badge tone="success">Draft on Etsy</s-badge>}
                    {p.etsy?.url && (
                      <div style={{ marginTop: 4 }}>
                        <a href={p.etsy.url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                          Open on Etsy
                        </a>
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          <s-stack direction="inline" gap="base">
            <s-button
              disabled={!d.pageInfo.hasPreviousPage || busy}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("after");
                next.set("before", d.pageInfo.startCursor);
                setParams(next);
              }}
            >
              ← Previous
            </s-button>
            <s-button
              disabled={!d.pageInfo.hasNextPage || busy}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete("before");
                next.set("after", d.pageInfo.endCursor);
                setParams(next);
              }}
            >
              Next →
            </s-button>
            <s-button variant="primary" disabled={!picked.length || busy || d.missing.length > 0} onClick={send}>
              {picked.length ? `Send ${picked.length} to Etsy as drafts` : "Send to Etsy as drafts"}
            </s-button>
          </s-stack>
        </s-stack>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
