import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export const meta: MetaFunction = () => [{ title: "Privacy policy – ReelStage" }];

// Draft privacy policy. Set SUPPORT_EMAIL and COMPANY_NAME in Render, and review the text before submitting to Meta and Shopify.
const UPDATED = "12 November 2026";

export const loader = () => ({
  contact: process.env.SUPPORT_EMAIL || "support@example.com",
  company: process.env.COMPANY_NAME || "the ReelStage team",
});

export default function Privacy() {
  const { contact: CONTACT, company } = useLoaderData<typeof loader>();
  const h2 = { fontSize: 20, marginTop: 32 } as const;
  return (
    <main style={{ maxWidth: 760, margin: "0 auto", padding: "48px 20px", fontFamily: "system-ui, sans-serif", lineHeight: 1.65, color: "#222" }}>
      <h1 style={{ fontSize: 30 }}>Privacy policy – ReelStage</h1>
      <p>Last updated: {UPDATED}</p>
      <p>
        ReelStage (“the app”), operated by {company}, lets Shopify merchants show reels from their own Instagram professional account on their
        Shopify store. This policy explains what information the app uses and why.
      </p>

      <h2 style={h2}>Information we collect</h2>
      <ul>
        <li>
          <strong>From Shopify:</strong> the store’s domain and the access token Shopify gives the app when it is installed. The
          app only asks to read and write the store’s Files and to read the store’s themes (to check the theme can show the
          reels block).
        </li>
        <li>
          <strong>From Instagram (only after the merchant connects):</strong> the Instagram account ID and username, the Facebook Page linked to it, an app-specific Facebook user ID,
          a long-lived access token, and details of the account’s own posts (post ID, caption, media type, video and thumbnail
          addresses, permalink and date).
        </li>
        <li>
          <strong>We do not collect</strong> Instagram passwords, followers, messages or comments, and we do not collect any
          information about the store’s customers.
        </li>
      </ul>

      <h2 style={h2}>How we use it</h2>
      <ul>
        <li>To list the merchant’s reels in the app so they can choose which ones to show.</li>
        <li>To copy the chosen reels into the merchant’s own Shopify Files and show them on the merchant’s store.</li>
        <li>We never sell, rent or share this information, and never use it for advertising.</li>
      </ul>

      <h2 style={h2}>Storage and security</h2>
      <p>
        Data is stored in a secured database. Instagram access tokens are encrypted (AES-256). The app is hosted on Render and
        the database on Neon, both using encrypted connections.
      </p>

      <h2 style={h2}>How long we keep it</h2>
      <ul>
        <li>When the merchant clicks Disconnect, the Instagram token and account details are deleted immediately.</li>
        <li>When the app is uninstalled, the Instagram token, account details and reel list are deleted immediately; Shopify’s
          shop-redact request removes any remaining store data.</li>
        <li>Reels already copied into the merchant’s Shopify Files belong to the merchant and stay there until they delete them.</li>
      </ul>

      <h2 style={h2}>Data deletion</h2>
      <p>
        You can delete your data at any time by clicking Disconnect in the app or uninstalling it. You can also remove the app’s
        access from Instagram (Settings → Website permissions → Apps and websites). To ask us to delete your data, email{" "}
        <a href={`mailto:${CONTACT}`}>{CONTACT}</a>; we will confirm within 30 days.
      </p>

      <h2 style={h2}>Contact</h2>
      <p>
        Questions about this policy: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>
      </p>
    </main>
  );
}
