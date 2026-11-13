# ListBridge

Shopify app: send your Shopify products to your Etsy shop as draft listings (photos, description, price, stock, SKU).
Separate app from ReelStage, in its own folder. See **SETUP_GUIDE.md**.

| Path | What it does |
|---|---|
| `app/lib/etsy.server.ts` | Etsy login (OAuth 2.0 + PKCE), token refresh, API calls, shop settings |
| `app/lib/listings.server.ts` | Turns a Shopify product into an Etsy draft (title/description/tag rules, price, photos, SKU), background queue |
| `app/routes/app._index.tsx` | Connect Etsy + Etsy listing settings |
| `app/routes/app.products.tsx` | Pick products and send them to Etsy as drafts |
| `app/routes/etsy.callback.tsx` | Etsy sends the merchant back here after approving |
| `app/routes/webhooks.*` | Uninstall + mandatory privacy (GDPR) webhooks |
| `app/routes/privacy.tsx` | Public privacy policy (`/privacy`) |

The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not endorsed or certified by Etsy, Inc.
