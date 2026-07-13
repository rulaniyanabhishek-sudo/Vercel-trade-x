import { PCR_THRESHOLDS } from '../data/universe.js';
import { compact, confidenceBar, dataPill, money, pageHeader, signalBadge, stockSymbolCell, changeHtml, formatDateTime, formatNumber } from '../ui/render.js';

export function renderWatchlist(state) {
  const order = [...(state.watchlist || new Set())];
  const rows = order.map((symbol) => state.analyses.find((a) => a.symbol === symbol)).filter(Boolean);
  const body = rows.map((a) => `<tr class="row-click pinned-row" data-action="open-stock" data-symbol="${a.symbol}"><td>${stockSymbolCell(a.quote, true)}</td><td><span data-live-symbol="${a.symbol}" data-field="ltp">${money(a.quote.ltp)}</span></td><td><span data-live-symbol="${a.symbol}" data-field="change">${changeHtml(a.quote.change, a.quote.changePct)}</span></td><td><span data-live-symbol="${a.symbol}" data-field="volume">${compact(a.quote.volume)}</span></td><td><span data-live-symbol="${a.symbol}" data-field="vwap">${money(a.indicators.vwap)}</span></td><td><span data-live-symbol="${a.symbol}" data-field="signal">${signalBadge(a.signal)}</span></td><td><span data-live-symbol="${a.symbol}" data-field="confidence">${confidenceBar(a.confidence, a.signal.includes('SELL'))}</span></td><td><span data-live-symbol="${a.symbol}" data-field="updated">${formatDateTime(a.timestamp)}</span></td></tr>`).join('');
  return `${pageHeader('Watchlist', 'Your locally stored watchlist. Starred stocks are shown in the exact order you marked them, and the same order is pinned at the top of Dashboard and Scanner lists.', '')}
    <div class="card"><div class="card-header"><div><h3 class="card-title">Tracked Symbols</h3><p class="card-subtitle">Use the star icon in tables to add/remove any number of symbols.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Stock</th><th>LTP</th><th>Change</th><th>Volume</th><th>VWAP</th><th>Signal</th><th>Confidence</th><th>Updated</th></tr></thead><tbody>${body || '<tr><td colspan="8"><div class="empty-state">No watchlist symbols yet. Add symbols from Dashboard or Stock Analysis.</div></td></tr>'}</tbody></table></div></div></div>`;
}

export function renderAlerts(state) {
  const alerts = state.alerts || [];
  return `${pageHeader('Alerts', 'Alert engine architecture for signal, PCR/VWAP, price, volume and risk events. Demo alerts are local only; production should fan out from the server.', `<button class="button primary">Create Alert</button>`)}
    <div class="warning-panel" style="margin-bottom:14px"><b>Demo alert mode:</b> Browser notifications and broker/API order routing are intentionally not enabled. Production alerts should be rate-limited, audited and user-confirmed.</div>
    <div class="card"><div class="card-header"><div><h3 class="card-title">Configured Alerts</h3><p class="card-subtitle">Examples of supported alert conditions.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Condition</th><th>Status</th><th>Data Mode</th></tr></thead><tbody>${alerts.map((a) => `<tr><td><b>${a.symbol}</b></td><td>${a.condition}</td><td><span class="pill info">${a.status}</span></td><td>${dataPill(state.snapshot.status)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

export function renderSettings(state) {
  const thresholds = Object.entries(PCR_THRESHOLDS).map(([name, t]) => `<tr><td>${name}</td><td>${t.veryLow}</td><td>${t.low}</td><td>${t.balancedHigh}</td><td>${t.high}</td><td>${t.extreme}</td></tr>`).join('');
  return `${pageHeader('Settings & Data Architecture', 'Provider-agnostic market-data architecture, PCR thresholds, risk controls and integration checklist. Credentials are never exposed in frontend code.', '')}
    <div class="grid cols-3" style="margin-bottom:14px">
      <div class="card pad"><div class="metric-label">Market Data Provider</div><div class="metric-value">Demo Provider</div><p class="muted small">Replace with an official/licensed API server adapter.</p></div>
      <div class="card pad"><div class="metric-label">Streaming</div><div class="metric-value">WebSocket-ready</div><p class="muted small">Current implementation simulates streaming with provider callbacks.</p></div>
      <div class="card pad"><div class="metric-label">Stale Data Guard</div><div class="metric-value">${state.settings.staleSeconds}s</div><p class="muted small">High confidence disabled for stale data.</p></div>
    </div>
    <div class="grid cols-2">
      <div class="card"><div class="card-header"><div><h3 class="card-title">Required Production Services</h3><p class="card-subtitle">Keep secrets server-side; frontend receives sanitized snapshots only.</p></div></div><div style="padding:16px"><ul class="explain-list">
        <li class="good">Market Data Service: official broker/vendor REST + WebSocket adapter.</li>
        <li class="good">Indicator Calculation Engine: server or worker execution for all candles.</li>
        <li class="good">Options Analytics Engine: OI, PCR, writing/unwinding, VWAP and combined signals.</li>
        <li class="good">Signal Engine: regime-adjusted weighted consensus and validation.</li>
        <li class="good">Risk Management Engine: ATR/support/resistance/Supertrend stops and targets.</li>
        <li class="good">PostgreSQL: signals, backtests, watchlists, alerts and audit records.</li>
        <li class="good">Redis: quote cache, rate-limit protection and stale-data detection.</li>
      </ul></div></div>
      <div class="card"><div class="card-header"><div><h3 class="card-title">Environment Variables</h3><p class="card-subtitle">Examples for a backend service; never ship secret keys in frontend bundles.</p></div></div><div style="padding:16px"><pre class="empty-state" style="white-space:pre-wrap">MARKET_DATA_PROVIDER=official_broker_or_vendor\nMARKET_DATA_API_KEY=server_only\nMARKET_DATA_API_SECRET=server_only\nBROKER_WS_URL=server_only\nPOSTGRES_URL=server_only\nREDIS_URL=server_only</pre></div></div>
    </div>
    <div class="card" style="margin-top:14px"><div class="card-header"><div><h3 class="card-title">Configurable PCR Interpretation Zones</h3><p class="card-subtitle">PCR is contextual. Extreme zones trigger warnings, not automatic trades.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Instrument</th><th>Very Low</th><th>Low</th><th>Balanced High</th><th>High</th><th>Extreme</th></tr></thead><tbody>${thresholds}</tbody></table></div></div></div>`;
}

export function renderLiveMarkets(state) {
  const rows = state.snapshot.indices.map((i) => `<tr><td><b>${i.label}</b><br><span class="muted small">${i.symbol}</span></td><td><span data-live-index="${i.symbol}" data-field="value" class="num">${formatNumber(i.value, 2)}</span></td><td><span data-live-index="${i.symbol}" data-field="change">${changeHtml(i.change, i.changePct)}</span></td><td><span data-live-index="${i.symbol}" data-field="high" class="num">${formatNumber(i.dayHigh, 2)}</span></td><td><span data-live-index="${i.symbol}" data-field="low" class="num">${formatNumber(i.dayLow, 2)}</span></td><td>${i.marketTrend}</td><td>${signalBadge(i.technicalSignal)}</td><td>${dataPill(i.dataStatus)}</td><td><span data-live-index="${i.symbol}" data-field="updated">${formatDateTime(i.timestamp)}</span></td></tr>`).join('');
  return `${pageHeader('Live Markets', 'Index overview and data-status monitor for Indian markets. Current build is demo streaming; production supports WebSocket provider adapters.', '')}
    <div class="card"><div class="card-header"><div><h3 class="card-title">Index Stream</h3><p class="card-subtitle">NIFTY 50, SENSEX, NIFTY BANK and India VIX.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Index</th><th>Value</th><th>Change</th><th>Day High</th><th>Day Low</th><th>Trend</th><th>Technical Signal</th><th>Data</th><th>Updated</th></tr></thead><tbody>${rows}</tbody></table></div></div></div>`;
}
