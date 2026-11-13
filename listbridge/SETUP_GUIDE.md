# ListBridge – setup guide

ListBridge sends Shopify products to an Etsy shop as **draft** listings (photos, description, converted price, stock, SKU).
It lives in the `listbridge/` folder of this repo and runs as its **own** app, separate from ReelStage:
its own Shopify app, its own Render service and its own Neon database. Never paste secrets into chat or GitHub.

Build and test on the **virasat-demo** development store only. Etsy has no test environment, so anything sent goes to a real
Etsy shop. ListBridge only ever creates drafts (free); publishing on Etsy is done by hand on Etsy.

## 1. Etsy developer app (needs the Etsy shop owner's login)
1. Log in to Etsy with the account that owns the Etsy shop, then open **etsy.com/developers/register**.
2. App name: **ListBridge** (Etsy doesn't allow "Etsy" in app names). Describe it as: "Shopify app that sends a merchant's own Shopify products to their own Etsy shop as draft listings."
3. Save the **Keystring** and **Shared secret** for Render (step 3). Don't share them.
4. In the app's settings, add the **Callback URL**: `https://listbridge.onrender.com/etsy/callback`
5. Later, for other merchants: **Apps You've Made → Request Commercial Access** (Etsy reviews this manually).

## 2. Shopify app
1. dev.shopify.com → **Apps → Create app** → name **ListBridge**.
2. Copy the **Client ID** into `listbridge/shopify.app.toml` → `client_id`, then commit and push.
3. Keep the **Client secret** for Render.

## 3. Neon database (separate from ReelStage)
neon.tech → your project → **Databases → New database** `listbridge` (or a new project). Copy its connection string.

## 4. Render web service
1. render.com → **New → Web Service** → this GitHub repo → name **listbridge**, Docker, free plan.
2. **Root Directory:** `listbridge` (important: otherwise Render builds ReelStage).
3. **Environment** (see `.env.example`):
   - `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (ListBridge's, not ReelStage's)
   - `SHOPIFY_APP_URL` = `https://listbridge.onrender.com`
   - `SCOPES` = `read_products,read_inventory`
   - `DATABASE_URL` = the new Neon database
   - `TOKEN_ENCRYPTION_KEY` = new long random text (40+ characters). Never change it later.
   - `ETSY_API_KEY` = Etsy keystring, `ETSY_SHARED_SECRET` = Etsy shared secret
   - `PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK` = `1`
   - `SUPPORT_EMAIL`, `COMPANY_NAME` (shown on /privacy)
4. Deploy and wait for **Live**.

## 5. Push the Shopify settings
In PowerShell:
```
cd C:\Users\Dell\Documents\GitHub\virasat_demo\listbridge
npm install
npx @shopify/cli@latest app deploy
```
Choose **ListBridge** when asked. Don't run `shopify app config link`.

## 6. Test on virasat-demo
1. Dev Dashboard → ListBridge → **Install** on virasat-demo.
2. **Connect Etsy** → log in on Etsy → **Allow access**.
3. **Etsy listing settings**: category (search "saree"), who made it, shipping profile, processing profile, exchange rate (1 INR = ? in the Etsy shop's currency), price adjustment → **Save settings**.
4. **Products** → tick one single-variant product that's in stock → **Send to Etsy as drafts**.
5. Click **Open on Etsy** to check the draft. Delete it on Etsy if it was only a test.

## What this first version does / doesn't do
- ✅ Connect Etsy (OAuth 2.0 + PKCE), tokens encrypted and refreshed automatically.
- ✅ Send single-variant products as drafts with up to 10 photos, plain-text description, tags, converted price, stock and SKU.
- ⏳ Next: stock sync (both ways), Etsy orders → Shopify, Etsy reviews block, products with variants.
