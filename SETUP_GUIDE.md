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
   - `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` (step 4)
   - `TOKEN_ENCRYPTION_KEY` = a long random text (40+ characters). **Never change it later**, or saved Instagram logins stop working.
   - `SUPPORT_EMAIL`, `COMPANY_NAME` = shown on the privacy page.
   - Optional `CRON_SECRET` = any long random text. A free scheduler (e.g. cron-job.org) can then open `https://reelstage.onrender.com/cron/sync?key=<CRON_SECRET>` every 2 hours to renew Instagram video links for every store (and keep a free server awake).
3. Deploy. The first deploy also builds the app; if it fails, send the build log.

## 4. Meta app (Facebook Login for Business → Instagram)
1. developers.facebook.com → **Create App** → use case **Manage messaging & content on Instagram** → connect a **business portfolio** (required).
2. In the use case, choose **API setup with Facebook login** (new apps can't use "Instagram login").
3. Left menu **Facebook Login for Business → Configurations → Create configuration**:
   - Name `ReelStage login`, login variation **General**, token type **User access token**.
   - Assets: **Pages** and **Instagram accounts**.
   - Permissions: `instagram_basic`, `pages_show_list`, `pages_read_engagement`, `business_management`.
   - Copy the **Configuration ID** → Render `META_LOGIN_CONFIG_ID`.
4. **Facebook Login for Business → Settings**:
   - Valid OAuth Redirect URIs: `https://reelstage.onrender.com/instagram/callback`
   - Deauthorize callback URL: `https://reelstage.onrender.com/instagram/deauthorize`
   - Data deletion request URL: `https://reelstage.onrender.com/instagram/data-deletion`
5. **App settings → Basic**: copy **App ID** → `META_APP_ID`, **App secret** → `META_APP_SECRET`; set Privacy Policy URL `https://reelstage.onrender.com/privacy`; App domain `reelstage.onrender.com`.
6. **App roles → Roles**: add yourself / testers. Testers' Instagram must be Business or Creator and linked to a Facebook Page they manage.

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
1. **Meta App Review**: request **Advanced Access** for `instagram_basic`, `pages_show_list`, `pages_read_engagement` and `business_management`. Upload a screen recording of: installing the app, connecting Instagram, choosing reels, and the reels showing on the store. Complete **Business Verification** if asked. Then switch the Meta app to **Live**.
2. **Shopify App Store**: Partner dashboard → Distribution → **Public**. Fill the listing (name, description, screenshots, privacy URL, support email, pricing = Free) and submit for review.

Until Meta approves, only Instagram accounts added as testers can connect.

## Before submitting to the Shopify App Store
- **Hosting:** use a paid Render plan (Starter) for the public app. The free plan sleeps after 15 minutes and takes up to a minute to wake, and Shopify's reviewers reject apps that load slowly.
- **Test as a stranger:** install on a second dev store with a different Instagram tester account, uninstall, reinstall, and check everything still works.
- **Listing text and screenshots:** see `LISTING.md`.
- **Reviewer access:** Shopify's reviewer needs an Instagram account that can connect. Until Meta approves the app, give them a test Instagram account that is added as a tester (in the submission's testing instructions), or get Meta approval first.
