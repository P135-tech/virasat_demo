import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export const meta: MetaFunction = () => [{ title: "Privacy policy – ListBridge" }];

const UPDATED = "13 November 2026";

export const loader = () => ({
  contact: process.env.SUPPORT_EMAIL || "support@example.com",
  company: process.env.COMPANY_NAME || "the ListBridge team",
});

export default function Privacy() {
  const { contact, company } = useLoaderData<typeof loader>();
  const h2 = { fontSize: 20, marginTop: 32 } as const;
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.65, color: "#222" }}>
      <h1 style={{ fontSize: 30 }}>Privacy policy – ListBridge</h1>
      <p>Last updated: {UPDATED}</p>
      <p>
        ListBridge (“the app”), operated by {company}, lets Shopify merchants send their own Shopify products to their own Etsy shop as
        draft listings. This policy explains what information the app uses and why.
      </p>

      <h2 style={h2}>Information we use</h2>
      <ul>
        <li>
          <strong>From Shopify:</strong> the store’s domain, the access token Shopify gives the app when it is installed, and the
          merchant’s product details (title, description, tags, price, SKU, stock and photos) for the products the merchant chooses to send.
        </li>
        <li>
          <strong>From Etsy (only after the merchant connects):</strong> the Etsy user ID, shop ID, shop name and currency, access and
          refresh tokens, and the shop’s shipping profiles, processing profiles, return policies and Etsy’s category list.
        </li>
        <li>
          <strong>We do not collect</strong> Etsy or Shopify passwords, and this version of the app does not read or store any orders or
          customer information.
        </li>
      </ul>

      <h2 style={h2}>How we use it</h2>
      <ul>
        <li>To create draft listings in the merchant’s own Etsy shop from the Shopify products they choose.</li>
        <li>To show the merchant which products are on Etsy and link to each draft.</li>
        <li>We never sell, rent or share this information, and never use it for advertising.</li>
      </ul>

      <h2 style={h2}>Storage and security</h2>
      <p>
        Data is stored in a secured database. Etsy tokens are encrypted (AES-256). The app is hosted on Render and the database on Neon,
        both using encrypted connections.
      </p>

      <h2 style={h2}>How long we keep it</h2>
      <ul>
        <li>When the merchant clicks Disconnect, the Etsy tokens and shop details are deleted immediately.</li>
        <li>When the app is uninstalled, the Etsy connection, settings and product links are deleted; Shopify’s shop-redact request removes any remaining store data.</li>
        <li>Draft listings already created on Etsy belong to the merchant and stay in their Etsy shop until they delete them.</li>
      </ul>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions or deletion requests: <a href={`mailto:${contact}`}>{contact}</a>. We reply within 30 days.
      </p>

      <p style={{ marginTop: 40, color: "#666", fontSize: 14 }}>
        The term “Etsy” is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
      </p>
    </main>
  );
}
