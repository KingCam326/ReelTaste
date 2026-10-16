# IGDB Worker setup — ~10 minutes, free, no command line

This Worker sits between the ReelTaste app and IGDB's API and holds your
Twitch secret server-side, so it never appears in the public app code.

## What you need first

From the Twitch developer portal (dev.twitch.tv/console → your app):

- **Client ID**
- **Client Secret** (click "New Secret" if you don't have one yet)

## 1. Free Cloudflare account

Sign up at https://dash.cloudflare.com/sign-up (no credit card).

## 2. Create the Worker

1. In the dashboard go to **Workers & Pages** → **Create** → **Create Worker**
2. Hit **Deploy** on the starter template (we'll replace it)
3. Click **Edit code**
4. Delete everything in the editor, paste the entire contents of `worker.js`
   from this folder
5. Click **Deploy** (top right)

## 3. Add your Twitch secrets

1. On the Worker's page go to **Settings** → **Variables**
2. Under **Secrets**, add two variables (choose "Secret" as the type):
   - `TWITCH_CLIENT_ID` → your Client ID
   - `TWITCH_CLIENT_SECRET` → your Client Secret
3. Save — the Worker redeploys automatically

## 4. Send Paul the Worker URL

It looks like `https://reeltaste-igdb.<your-subdomain>.workers.dev`.
You'll see it on the Worker's overview page.

Paste it here and I'll wire the games side of the app to it and verify
it's working end to end.

## How it works (for the curious)

- The app sends game queries to `https://<your-worker>/igdb/games`
- The Worker fetches a Twitch login token itself (auto-refreshes, tokens last
  ~60 days), attaches it, and forwards the query to IGDB
- Responses are cached at Cloudflare's edge for an hour, so repeat lookups
  don't count against IGDB's rate limits
- Only read-only game-data endpoints are exposed (`games`, `covers`,
  `screenshots`, `videos`, `genres`, …) — nothing else can be reached through it
