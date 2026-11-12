# ReelStage

A public Shopify app: merchants connect their Instagram Business/Creator account, pick reels, and show them on their store with the **ReelStage reels** theme block.

## How it works

1. **Connect Instagram** (Instagram Graph API via Facebook Login for Business, `config_id`). The merchant logs in with Facebook; the app finds the Instagram Business/Creator account linked to their Page and stores a non-expiring Page token, **encrypted**.
2. **Pick reels.** The app lists the account's reels; the merchant ticks up to 20 and sets their order.
3. **Copy to Shopify Files.** Each chosen reel is downloaded and uploaded to the store's Files (staged upload → `fileCreate`), so the video lives on Shopify's CDN and never expires.
4. **Show on the store.** The ready reels are written to an app-data metafield (`app.metafields.reels.selected`), which the theme app extension block `extensions/reels/blocks/reels.liquid` renders as a slider with a full-screen player.

## Code map

| Path | What it does |
|---|---|
| `app/routes/app._index.tsx` | Main screen: connect, choose reels, order, remove |
| `app/routes/app.help.tsx` | How to add the block to the theme |
| `app/routes/instagram.callback.tsx` | Instagram sends the merchant back here after "Allow" |
| `app/lib/instagram.server.ts` | Instagram login, token refresh, reading reels |
| `app/lib/reels.server.ts` | Copy to Shopify Files, status checks, storefront metafield |
| `app/lib/crypto.server.ts` | Token encryption and signed login state |
| `app/routes/webhooks.*` | Uninstall + mandatory privacy (GDPR) webhooks |
| `app/routes/privacy.tsx` | Public privacy policy page (`/privacy`) |
| `extensions/reels/` | Theme app extension (block, CSS, JS) |

See **SETUP_GUIDE.md** for deployment and app review steps.
