# Trade X — Indian Market Intelligence

A professional Indian stock market analysis and trading intelligence web application prototype.

## Important data/safety note

This build runs in **DEMO MODE** because no licensed live market-data credentials were provided. Prices, option chains, signals and backtests are realistic simulations and are clearly labelled as demo data in the UI. The architecture is provider-agnostic and ready to connect to legitimate broker/market-data APIs.

The app never claims guaranteed profits. Signals are probabilistic, include supporting/conflicting evidence, risk level, invalidation, timestamp, and quality-control warnings.

## What is implemented

- Premium dark trading-terminal UI inspired by Indian broker/analytics platforms, with original styling.
- Dashboard for NIFTY 50 + SENSEX universe with live demo updates.
- Market overview: NIFTY 50, SENSEX, NIFTY BANK, India VIX, market breadth, regime and volatility.
- Stock table: LTP, change, O/H/L/prev close, volume, relative volume, VWAP, RSI, MACD, Supertrend, signal, confidence and timestamp.
- Search, sorting, filters, tabs and watchlist.
- Stock detail page with canvas candlestick chart, VWAP/EMA overlays, support/resistance, indicator table and plain-language signal explanation.
- Technical Scanner with multi-timeframe indicator summaries.
- Trade Opportunities page with entry, stop-loss, targets and risk/reward based on ATR/support/resistance/Supertrend/pivots.
- Options Intelligence page for NIFTY and BANK NIFTY with call/put option tables, ATM/highest OI/max writing highlights, PCR engine, VWAP engine and combined signal table.
- Historical signal journal and demo-only backtest/performance capability with “insufficient licensed historical data” warning.
- Modular architecture: provider abstraction, indicator engine, options analytics, signal engine, risk engine, backtest engine, store and page modules.

## Run locally

### Static/offline mode

Open `index.html` in the Arena viewer or serve the folder with any static server:

```bash
cd indian-market-intelligence
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

### Live-analysis server mode

For continuous internet-based refresh during Indian market hours, run the Node live server:

```bash
cd indian-market-intelligence
npm run serve:live
```

Then open:

```text
http://localhost:8080
```

The frontend now attempts automatic price refresh every **1 second** during the Indian market session window **09:00–15:00 IST**. It skips overlapping requests if a free-feed pull is still in progress, then re-runs the dashboard, scanner, options/VWAP/PCR, signal and risk engines on each fresh snapshot. If the upstream timestamp is current, the app labels data as `LIVE`; otherwise it labels it `DELAYED` or `STALE` instead of pretending it is live.

## Provider architecture

The demo provider implements the same surface expected from a real provider:

- `connect()` / `disconnect()`
- `subscribe(callback)` for streaming market snapshots
- `getSnapshot()`
- `getCandles(symbol, timeframe)`
- `getIndexCandles(indexSymbol, timeframe)`
- `getOptionsChain(instrument)`

For production, implement the interface using an official/licensed data provider. Keep broker/API keys server-side only.

Suggested environment variables for a backend integration:

```env
MARKET_DATA_PROVIDER=official_broker_or_vendor
MARKET_DATA_API_KEY=server_only
MARKET_DATA_API_SECRET=server_only
BROKER_WS_URL=server_only
POSTGRES_URL=server_only
REDIS_URL=server_only
```

## Production hardening checklist

- Replace demo data provider with licensed provider implementation.
- Move data acquisition, API keys, caching, rate limiting and alert fan-out to a server service.
- Persist signal journal/backtests to PostgreSQL.
- Use Redis for live quote cache and stale-data protection.
- Add authenticated user accounts, watchlists and notifications.
- Add exchange-compliant data entitlements and audit logs.
