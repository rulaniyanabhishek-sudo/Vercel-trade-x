# Server architecture blueprint

This preview app runs fully in the browser in clearly-labelled DEMO MODE. For production, add a server-side market data service with these modules:

- REST API: `/api/market/snapshot`, `/api/stocks/:symbol/candles`, `/api/options/:instrument`, `/api/signals`, `/api/backtests`.
- WebSocket gateway: quote stream, option chain stream, stale-data events and alert fan-out.
- Provider adapters: official broker/vendor adapters implementing `MarketDataProvider`, `OptionsDataProvider` and `HistoricalDataProvider`.
- PostgreSQL persistence: users, watchlists, generated signals, backtests, alert history and audit logs.
- Redis cache: live quotes, option chains, rate-limit protection and reconnect buffering.
- Secret management: all API keys remain server-side via environment variables.

Do not scrape websites illegally. Use licensed Indian market data/broker APIs and honour exchange data rules.
