# aretay-web

Static website for Aretay. Hosts the privacy policy, support page, and App Store landing page. No build step — plain HTML files deployable to any static host.

## Pages

| File | URL | Purpose |
|------|-----|---------|
| `index.html` | `/` | Landing page with App Store link |
| `privacy.html` | `/privacy` | Privacy policy (required for App Store) |
| `support.html` | `/support` | Support FAQ + contact (required for App Store) |

## Deploy

Upload the folder to any static host:

- **Cloudflare Pages** — connect GitHub repo, root directory `aretay-web`, no build command
- **Netlify** — drag-and-drop the `aretay-web` folder in the Netlify dashboard
- **GitHub Pages** — serve from `aretay-web/` or a dedicated branch
- **Vercel** — import repo, set root directory to `aretay-web`

## Before going live

1. **App Store URL** — replace the `href` in `index.html` `<a class="store-btn">` with the real App Store link once the app is published.
2. **Support email** — `will@aretay.ai` is already set in `privacy.html` and `support.html`.
3. **App icon** — drop `icon.png` (the Aretay app icon, square, ≥ 180 × 180px) into this folder. It is referenced as `href="icon.png"` in all three pages.
4. **Privacy policy URL** — enter the public URL of `privacy.html` in App Store Connect → App Information → Privacy Policy URL.
5. **Support URL** — enter the public URL of `support.html` in App Store Connect → App Information → Support URL.

## URLs for App Store Connect

Once deployed, the two fields Apple requires:

| Field | Value |
|-------|-------|
| Privacy Policy URL | `https://aretay.ai/privacy.html` |
| Support URL | `https://aretay.ai/support.html` |

Both must be publicly accessible without login.
