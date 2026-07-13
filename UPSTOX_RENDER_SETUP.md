# Trade X + Upstox + Render Setup

This project is now prepared for an official **Upstox server-side market-data adapter**.

## Why server-side?

Do not put your Upstox access token in browser JavaScript or GitHub Pages. Render runs the backend and keeps secrets in environment variables.

## Architecture

```text
GitHub Pages / Trade X frontend
        ↓
Render Node backend
        ↓
Upstox official API
```

The frontend will call:

```text
https://YOUR-RENDER-SERVICE.onrender.com/api/market/snapshot
https://YOUR-RENDER-SERVICE.onrender.com/api/options/nifty-table
```

## Files added

```text
server/providers/upstox-provider.mjs
server/start-live.mjs
render.yaml
.env.example
```

## Render deployment

1. Push this repository to GitHub.
2. Go to Render → New → Web Service.
3. Connect the GitHub repo.
4. Use:

```text
Build Command: npm install
Start Command: npm run serve:live
Health Check Path: /api/health
```

5. Add environment variables in Render:

```env
MARKET_DATA_PROVIDER=upstox
UPSTOX_ACCESS_TOKEN=your_upstox_access_token
BQ_LIVE_TTL_MS=1000
BQ_CLOSED_TTL_MS=1000
BQ_OPTIONS_TTL_MS=1000
BQ_OPTIONS_CLOSED_TTL_MS=15000
BQ_CORS_ORIGIN=*
```

Optional:

```env
UPSTOX_NIFTY_EXPIRY_DATE=2026-07-14
```

If `UPSTOX_NIFTY_EXPIRY_DATE` is not set, the server picks the nearest future NIFTY expiry from the Upstox instrument master.

## Local test

Create `.env`:

```bash
cp .env.example .env
# edit .env and paste your UPSTOX_ACCESS_TOKEN
npm run serve:live
```

Open:

```text
http://localhost:8080/api/health
http://localhost:8080/api/market/snapshot
http://localhost:8080/api/options/nifty-table
```

## Frontend config

In production GitHub Pages, edit `config.js` and set:

```js
window.BQ_LIVE_API_BASE = "https://YOUR-RENDER-SERVICE.onrender.com";
```

The app checks `window.BQ_LIVE_API_BASE`; if set, it will use Render/Upstox first.

## What Upstox adapter provides

- NSE equity quotes for tracked stocks
- NIFTY 50 / BANK NIFTY / SENSEX index quote attempts
- NIFTY option-chain table via official Upstox option-chain endpoint
- PCR, OI totals, OI change, VWAP signal table normalization
- 1-second server cache while market is open
- fallback to free sources if Upstox fails, so the UI does not break
