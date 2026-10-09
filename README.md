# ReelTaste — Movie & TV Recommendations

A mobile-first web app. Import your IMDb ratings CSV **or** rate titles Tinder-style,
and get personalized movie/TV recommendations. Everything runs in the browser —
no server, no tracking, free to host.

## Try it locally

Just open `index.html` in a browser (double-click it). For the full mobile feel,
use your phone's browser or Chrome DevTools device mode.

## Deploy free (GitHub Pages)

1. Create a new public repository on GitHub (e.g. `reeltaste`).
2. Upload all files in this folder (`index.html`, `styles.css`, `app.js`,
   `engine.js`, `catalog.js`) to the repo root.
3. In the repo: **Settings → Pages** → Source: **Deploy from a branch**,
   Branch: **main** / **(root)** → Save.
4. Your site will be live at `https://<username>.github.io/reeltaste/` in a minute or two.

Alternative: drag this folder into [Netlify Drop](https://app.netlify.com/drop) —
instant free site, no account needed.

## How it works

- **Profiles** — create a username; ratings, imports, and hidden titles are saved
  per profile in the browser's `localStorage`.
- **IMDb import** — parses the official IMDb ratings CSV export client-side.
- **Swipe** — ♥ = liked (8/10), ✕ = disliked (3/10), ? or swipe up = haven't seen
  (skipped without rating; stays eligible for recommendations).
- **Recommendations** — content-based engine (`engine.js`): per-genre and
  per-director average ratings (with shrinkage toward your overall mean) score
  every unseen title in the bundled catalog (`catalog.js`, ~180 titles).
- **Privacy** — your CSV never leaves the device; there is no backend.

## Movie posters & synopses (optional, free)

IMDb doesn't offer a public API, so the app uses
[TMDB](https://www.themoviedb.org) (free) for posters and synopses:

1. Create a free account at themoviedb.org.
2. Go to **Settings → API** and copy your **API Key** (v3 auth).
3. In the app, open **Profile**, paste the key, tap **Save key**.

Cards will then show real posters and synopses. Without a key, the app uses
its built-in generated card art. Lookups are cached on-device to respect
TMDB's free rate limits. Each user needs their own key — keys are stored only
in that browser's localStorage, never sent anywhere except TMDB's API.

## Files

| File | Purpose |
|---|---|
| `index.html` | App shell, screens, tab bar |
| `styles.css` | Mobile-first dark theme |
| `app.js` | UI: profiles, swipe deck, import, recommendations |
| `engine.js` | Taste-profile + scoring engine (also testable in Node) |
| `catalog.js` | Bundled movie/TV catalog |
