import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { etsy, EtsyError } from "./etsy.server";

/** The part of the Shopify Admin API client this file needs. */
export type Admin = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

async function gql<T>(admin: Admin, query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = (await res.json()) as { data?: T; errors?: unknown };
  if (json.errors) throw new Error(`Shopify error: ${JSON.stringify(json.errors).slice(0, 300)}`);
  return json.data as T;
}

// ---------- Listing defaults ----------

export async function getDefaults(shop: string) {
  return (await db.listingDefaults.findUnique({ where: { shop } })) ?? {
    shop,
    taxonomyId: null,
    taxonomyPath: null,
    whoMade: "someone_else",
    whenMade: "made_to_order",
    shippingProfileId: null,
    readinessStateId: null,
    returnPolicyId: null,
    exchangeRate: 1,
    markupPercent: 0,
  };
}

/** What is still missing before products can be sent to Etsy. */
export function missingDefaults(d: Awaited<ReturnType<typeof getDefaults>>) {
  const missing: string[] = [];
  if (!d.taxonomyId) missing.push("Etsy category");
  if (!d.shippingProfileId) missing.push("Shipping profile");
  if (!d.readinessStateId) missing.push("Processing profile");
  if (!(d.exchangeRate > 0)) missing.push("Exchange rate");
  return missing;
}

// ---------- Making Shopify content fit Etsy's rules ----------

/** Etsy titles: max 140 characters; only letters, numbers, punctuation and symbols; %, : and & at most once; max 3 all-caps words. */
export function etsyTitle(raw: string) {
  let t = raw.normalize("NFC").replace(/[^\p{L}\p{N}\p{P}\p{Sm}\s™©®]/gu, " ");
  for (const ch of ["%", ":", "&"]) {
    let seen = false;
    t = t.replace(new RegExp(`\\${ch}`, "g"), () => (seen ? " " : ((seen = true), ch)));
  }
  let caps = 0;
  t = t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => {
      if (w.length > 1 && w === w.toUpperCase() && /\p{Lu}/u.test(w)) {
        caps++;
        if (caps > 3) return w.charAt(0) + w.slice(1).toLowerCase();
      }
      return w;
    })
    .join(" ");
  return t.slice(0, 140).trim();
}

/** Shopify's HTML description as plain text with line breaks (Etsy descriptions are plain text). */
export function etsyDescription(html: string, fallback: string) {
  const text = (html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text || fallback;
}

/** Etsy tags: up to 13, each up to 20 characters of letters, numbers, spaces, - and '. */
export function etsyTags(tags: string[]) {
  const out: string[] = [];
  for (const raw of tags) {
    const t = raw.replace(/[^\p{L}\p{N}\s\-'™©®]/gu, " ").replace(/\s+/g, " ").trim();
    if (!t || t.length > 20 || out.some((o) => o.toLowerCase() === t.toLowerCase())) continue;
    out.push(t);
    if (out.length === 13) break;
  }
  return out;
}

export function etsyPrice(shopifyPrice: number, rate: number, markupPercent: number) {
  return Math.round(shopifyPrice * rate * (1 + markupPercent / 100) * 100) / 100;
}

// ---------- Sending products ----------

type ProductForEtsy = {
  product: {
    title: string;
    descriptionHtml: string;
    tags: string[];
    variantsCount: { count: number };
    variants: { nodes: { price: string; sku: string | null; inventoryQuantity: number | null }[] };
    media: { nodes: { image?: { url: string; altText: string | null } | null }[] };
  } | null;
};

async function loadProduct(admin: Admin, id: string) {
  const data = await gql<ProductForEtsy>(
    admin,
    `#graphql
    query P($id: ID!) {
      product(id: $id) {
        title
        descriptionHtml
        tags
        variantsCount { count }
        variants(first: 1) { nodes { price sku inventoryQuantity } }
        media(first: 10) { nodes { ... on MediaImage { image { url altText } } } }
      }
    }`,
    { id },
  );
  if (!data.product) throw new Error("This product no longer exists in Shopify.");
  return data.product;
}

/** Creates one Etsy draft listing (with photos and SKU) from a Shopify product. Returns the Etsy listing id. */
async function sendOne(admin: Admin, shop: string, linkId: string, productId: string) {
  const d = await getDefaults(shop);
  const missing = missingDefaults(d);
  if (missing.length) throw new Error(`Finish the Etsy listing settings first: ${missing.join(", ")}.`);

  const p = await loadProduct(admin, productId);
  if (p.variantsCount.count > 1) {
    throw new Error("Products with several variants (sizes, colours) aren't supported yet. Only single-variant products can be sent.");
  }
  const v = p.variants.nodes[0];
  const qty = Math.min(999, Math.max(0, v?.inventoryQuantity ?? 0));
  if (qty < 1) throw new Error("Out of stock in Shopify. Etsy listings need a quantity of at least 1.");
  const price = etsyPrice(Number(v.price), d.exchangeRate, d.markupPercent);
  if (!(price >= 0.2)) throw new Error("The converted price is too low for Etsy (minimum 0.20). Check the exchange rate.");

  const form: Record<string, string> = {
    quantity: String(qty),
    title: etsyTitle(p.title),
    description: etsyDescription(p.descriptionHtml, p.title),
    price: price.toFixed(2),
    who_made: d.whoMade,
    when_made: d.whenMade,
    taxonomy_id: String(d.taxonomyId),
    shipping_profile_id: d.shippingProfileId!,
    readiness_state_id: d.readinessStateId!,
    is_supply: "false",
    type: "physical",
  };
  if (d.returnPolicyId) form.return_policy_id = d.returnPolicyId;
  const tags = etsyTags(p.tags);
  if (tags.length) form.tags = tags.join(",");

  // A draft costs nothing on Etsy. The merchant reviews and publishes it on Etsy (publishing has a listing fee).
  const created = await etsy<{ listing_id: number }>(shop, "POST", "/shops/{shop_id}/listings?legacy=false", { form });
  const listingId = String(created.listing_id);
  await db.listingLink.update({ where: { id: linkId }, data: { etsyListingId: listingId } });

  const problems: string[] = [];

  // Photos (Etsy allows up to 10).
  const images = p.media.nodes.map((m) => m.image).filter((i): i is { url: string; altText: string | null } => !!i?.url);
  for (let i = 0; i < images.length; i++) {
    try {
      const res = await fetch(images[i].url);
      if (!res.ok) throw new Error(`download failed (${res.status})`);
      const type = res.headers.get("content-type") || "image/jpeg";
      const ext = type.includes("png") ? "png" : type.includes("gif") ? "gif" : "jpg";
      const fd = new FormData();
      fd.append("image", new Blob([await res.arrayBuffer()], { type }), `photo-${i + 1}.${ext}`);
      fd.append("rank", String(i + 1));
      if (images[i].altText) fd.append("alt_text", images[i].altText!.slice(0, 500));
      await etsy(shop, "POST", `/shops/{shop_id}/listings/${listingId}/images`, { multipart: fd });
    } catch (e) {
      problems.push(`photo ${i + 1}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // SKU (kept the same as in Shopify so stock sync can match them later).
  if (v.sku) {
    try {
      await etsy(shop, "PUT", `/listings/${listingId}/inventory?legacy=false`, {
        json: {
          products: [
            {
              sku: v.sku.slice(0, 32),
              offerings: [{ price, quantity: qty, is_enabled: true, readiness_state_id: Number(d.readinessStateId) }],
              property_values: [],
            },
          ],
          price_on_property: [],
          quantity_on_property: [],
          sku_on_property: [],
          readiness_state_on_property: [],
        },
      });
    } catch (e) {
      problems.push(`SKU: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { listingId, note: problems.length ? `Draft created, but: ${problems.join("; ")}` : null };
}

/** Adds products to the queue (products already on Etsy are skipped) and starts sending in the background. */
export async function queueProducts(shop: string, products: { id: string; title: string }[]) {
  let added = 0;
  for (const p of products) {
    const existing = await db.listingLink.findUnique({ where: { shop_shopifyProductId: { shop, shopifyProductId: p.id } } });
    if (existing?.etsyListingId) continue;
    await db.listingLink.upsert({
      where: { shop_shopifyProductId: { shop, shopifyProductId: p.id } },
      create: { shop, shopifyProductId: p.id, title: p.title, status: "queued" },
      update: { title: p.title, status: "queued", error: null },
    });
    added++;
  }
  processQueue(shop);
  return added;
}

const running = new Set<string>();

/** Sends queued products one at a time (Etsy has rate limits), even if the merchant closes the app. */
export function processQueue(shop: string) {
  if (running.has(shop)) return;
  running.add(shop);
  void (async () => {
    try {
      const { admin } = await unauthenticated.admin(shop);
      for (;;) {
        const next = await db.listingLink.findFirst({ where: { shop, status: "queued" }, orderBy: { createdAt: "asc" } });
        if (!next) break;
        await db.listingLink.update({ where: { id: next.id }, data: { status: "sending", error: null } });
        try {
          const { listingId, note } = await sendOne(admin as unknown as Admin, shop, next.id, next.shopifyProductId);
          await db.listingLink.update({ where: { id: next.id }, data: { status: "draft", etsyListingId: listingId, error: note } });
        } catch (e) {
          const msg = e instanceof EtsyError && e.status === 401 ? "Etsy login expired. Click Reconnect Etsy." : e instanceof Error ? e.message : String(e);
          await db.listingLink.update({ where: { id: next.id }, data: { status: "failed", error: msg.slice(0, 500) } });
        }
      }
    } catch (e) {
      console.error("processQueue failed", e);
    } finally {
      running.delete(shop);
    }
  })();
}

/** After a server restart, continues anything left half-way. */
export async function resumeQueue(shop: string) {
  if (running.has(shop)) return;
  await db.listingLink.updateMany({
    where: { shop, status: "sending", updatedAt: { lt: new Date(Date.now() - 5 * 60 * 1000) } },
    data: { status: "queued" },
  });
  const waiting = await db.listingLink.count({ where: { shop, status: "queued" } });
  if (waiting) processQueue(shop);
}

/** A reinstall starts fresh, even if Shopify's "app uninstalled" message was missed. */
export async function forgetOldInstall(admin: Admin, shop: string) {
  const conn = await db.etsyConnection.findUnique({ where: { shop } });
  if (!conn) return;
  const data = await gql<{ currentAppInstallation: { id: string } }>(admin, `#graphql
    query { currentAppInstallation { id } }`);
  const id = data.currentAppInstallation.id;
  if (conn.installId && conn.installId !== id) {
    await forgetShop(shop);
    return;
  }
  if (!conn.installId) await db.etsyConnection.update({ where: { shop }, data: { installId: id } });
}

/** Removes everything we keep for a store (Etsy listings already created stay on Etsy). */
export async function forgetShop(shop: string) {
  await db.etsyConnection.deleteMany({ where: { shop } });
  await db.etsyAuthState.deleteMany({ where: { shop } });
  await db.listingDefaults.deleteMany({ where: { shop } });
  await db.listingLink.deleteMany({ where: { shop } });
}
