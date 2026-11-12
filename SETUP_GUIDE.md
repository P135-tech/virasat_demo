# ReelStage – setup guide

Same setup as Store Sync: **GitHub → Render (app) + Neon (database)**. Never paste secrets into chat or commit them.

## 1. Shopify Partner app
1. partners.shopify.com → **Apps → Create app → Create app manually**, name **ReelStage**.
2. Copy the **Client ID** into `shopify.app.toml` → `client_id`, and commit.
3. Keep the **Client secret** for Render (step 3).

## 2. Neon database
1. neon.tech → new project **reelstage** (free).
2. Copy the connection string (postgresql://…) for Render.

## 3. Render web service
1. render.com → **New → Web Service** → this GitHub repo → **Docker**, free plan, name **reelstage**.
2. **Environment** (see `.env.example`):
   - `SHOPIFY_API_KEY` = Client ID, `SHOPIFY_API_SECRET` = Client secret
   - `SHOPIFY_APP_URL` = `https://reelstage.onrender.com` (your Render address)
   - `SCOPES` = `read_files,write_files,read_themes`
   - `DATABASE_URL` = Neon connection string
   - `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` (step 4)
   - `TOKEN_ENCRYPTION_KEY` = a long random text (40+ characters). **Never change it later**, or saved Instagram logins stop working.
   - `SUPPORT_EMAIL`, `COMPANY_NAME` = shown on the privacy page.
3. Deploy. The first deploy also builds the app; if it fails, send the build log.

## 4. Meta (Instagram) app
1. developers.facebook.com → **Create app** → use case **Instagram API with Instagram Login** → type **Business**.
2. **Instagram → API setup with Instagram login**:
   - Copy **Instagram app ID** and **Instagram app secret** into Render.
   - **Business login settings → OAuth redirect URIs**: `https://reelstage.onrender.com/instagram/callback`
   - Under **Generate access tokens → Add account**, add your own Instagram account as a **tester** (needed until App Review).
3. **App settings → Basic**: Privacy Policy URL `https://reelstage.onrender.com/privacy`, a Data Deletion Instructions URL (same page), app icon, category.

## 5. Push the Shopify config and theme block
On your computer, in this repo (Node 22 + Shopify CLI installed):
```
npm install
shopify app config link     # choose "ReelStage"
shopify app deploy          # sends shopify.app.toml + the ReelStage reels theme block
```

## 6. Test on the dev store
Partner dashboard → ReelStage → **Test your app** → install on the dev store → Connect Instagram → tick reels → Save → **How to show reels → Add to home page** → Save in the theme editor.

## 7. Go public
1. **Meta App Review**: request **Advanced Access** for `instagram_business_basic`. Upload a screen recording of: installing the app, connecting Instagram, choosing reels, and the reels showing on the store. Complete **Business Verification** if asked. Then switch the Meta app to **Live**.
2. **Shopify App Store**: Partner dashboard → Distribution → **Public**. Fill the listing (name, description, screenshots, privacy URL, support email, pricing = Free) and submit for review.

Until Meta approves, only Instagram accounts added as testers can connect.

## Before submitting to the Shopify App Store
- **Hosting:** use a paid Render plan (Starter) for the public app. The free plan sleeps after 15 minutes and takes up to a minute to wake, and Shopify's reviewers reject apps that load slowly.
- **Test as a stranger:** install on a second dev store with a different Instagram tester account, uninstall, reinstall, and check everything still works.
- **Listing text and screenshots:** see `LISTING.md`.
- **Reviewer access:** Shopify's reviewer needs an Instagram account that can connect. Until Meta approves the app, give them a test Instagram account that is added as a tester (in the submission's testing instructions), or get Meta approval first.
