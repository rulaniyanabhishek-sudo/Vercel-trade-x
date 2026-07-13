# Deploy Trade X on Vercel instead of Render

Vercel can host the frontend and serverless API routes in one deployment. This avoids the Render card screen.

## What works on Vercel

- Static Trade X frontend
- `/api/health`
- `/api/market/snapshot`
- `/api/options/nifty-table`
- Server-side Upstox token stored as an environment variable

## Deploy steps

1. Push this repo to GitHub.
2. Go to https://vercel.com/new
3. Import the `trade-x` GitHub repository.
4. Keep framework as **Other** or **Static** if asked.
5. Build command:

```bash
npm run build
```

6. Output directory:

```text
.
```

7. Add Environment Variables:

```env
MARKET_DATA_PROVIDER=upstox
UPSTOX_ACCESS_TOKEN=your_upstox_access_token
BQ_LIVE_TTL_MS=1000
BQ_CLOSED_TTL_MS=30000
BQ_OPTIONS_TTL_MS=1000
BQ_OPTIONS_CLOSED_TTL_MS=15000
BQ_CORS_ORIGIN=*
```

Optional:

```env
UPSTOX_NIFTY_EXPIRY_DATE=2026-07-14
```

8. Click Deploy.

## After deploy

Your frontend will be:

```text
https://trade-x.vercel.app/
```

Health check:

```text
https://trade-x.vercel.app/api/health
```

If Upstox is configured correctly, health should show:

```json
"officialProvider": "upstox"
```

Option table API:

```text
https://trade-x.vercel.app/api/options/nifty-table
```

## Important

Vercel serverless functions are not a true streaming WebSocket server. The frontend will poll the API. For high-frequency production usage, monitor Vercel limits and Upstox rate limits.
