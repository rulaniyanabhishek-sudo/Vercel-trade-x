# Live Analysis Mode

The static GitHub Pages build cannot run a backend process. For live refresh while the Indian market is open, deploy or run the included Node server.

## Local live mode

```bash
cd indian-market-intelligence
npm run serve:live
```

Open:

```text
http://localhost:8080
```

During **09:00–15:00 IST**, the frontend polls:

```text
/api/market/snapshot
```

approximately every 1 second during the live session window. If the previous free-feed request is still running, the next tick is skipped to prevent overlapping requests. Each successful refresh re-runs:

- market overview
- dashboard prices
- RSI / MACD / VWAP / Supertrend / ADX / ATR calculations
- Technical Scanner
- Trade Opportunities
- Options Intelligence PCR + VWAP logic
- signal confidence and risk engine

## Deploy live server

Any Node host works. Example commands:

```bash
npm install
npm run serve:live
```

Required runtime:

```text
Node.js 20+
PORT=8080  # optional; most hosts provide this automatically
```

Optional environment variables:

```env
BQ_FETCH_CONCURRENCY=6
BQ_LIVE_TTL_MS=30000
BQ_CLOSED_TTL_MS=300000
BQ_CORS_ORIGIN=https://yourdomain.com
```

## Data status behavior

The app never fakes live data:

- `LIVE` = market session is open and upstream timestamp is current.
- `DELAYED` = data is recent but not current enough for a live label, or market is closed.
- `STALE` = timestamp is too old.
- `DEMO` = no online provider/server is available.

For exchange-certified live NSE/BSE data, connect an official broker or licensed market-data provider to the server-side provider layer.
