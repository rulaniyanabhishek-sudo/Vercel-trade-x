import { compact, confidenceBar, dataPill, disclaimer, indexCard, money, number, pageHeader, signalBadge, stockSymbolCell, changeHtml, formatDateTime, formatNumber, formatPct } from '../ui/render.js';
import { directionClass, percentDistance } from '../core/utils.js';

const TABS = [
  ['all', 'All Stocks'], ['watchlist', 'Watchlist'], ['nifty50', 'NIFTY 50'], ['sensex', 'SENSEX'], ['banknifty', 'NIFTY BANK'], ['gainers', 'Top Gainers'], ['losers', 'Top Losers'],
  ['active', 'Most Active'], ['highVolume', 'High Volume'], ['strongBuy', 'Strong Buy'], ['strongSell', 'Strong Sell'], ['nearSupport', 'Near Support'], ['nearResistance', 'Near Resistance']
];

function filterAnalyses(analyses, state) {
  const q = (state.search || '').trim().toLowerCase();
  let rows = analyses.filter((a) => !q || a.symbol.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.quote.sector.toLowerCase().includes(q));
  switch (state.dashboardTab) {
    case 'watchlist': rows = rows.filter((a) => state.watchlist?.has(a.symbol)); break;
    case 'nifty50': rows = rows.filter((a) => a.quote.indices.includes('NIFTY50')); break;
    case 'sensex': rows = rows.filter((a) => a.quote.indices.includes('SENSEX')); break;
    case 'banknifty': rows = rows.filter((a) => a.quote.indices.includes('BANKNIFTY')); break;
    case 'gainers': rows = rows.filter((a) => a.quote.changePct > 0).sort((a, b) => b.quote.changePct - a.quote.changePct); break;
    case 'losers': rows = rows.filter((a) => a.quote.changePct < 0).sort((a, b) => a.quote.changePct - b.quote.changePct); break;
    case 'active': rows = [...rows].sort((a, b) => b.quote.volume - a.quote.volume); break;
    case 'highVolume': rows = rows.filter((a) => a.quote.relVolume >= 1.15).sort((a, b) => b.quote.relVolume - a.quote.relVolume); break;
    case 'strongBuy': rows = rows.filter((a) => a.signal === 'STRONG BUY'); break;
    case 'strongSell': rows = rows.filter((a) => a.signal === 'STRONG SELL'); break;
    case 'nearSupport': rows = rows.filter((a) => a.riskPlan.support && Math.abs(percentDistance(a.quote.ltp, a.riskPlan.support.price)) < 0.8); break;
    case 'nearResistance': rows = rows.filter((a) => a.riskPlan.resistance && Math.abs(percentDistance(a.riskPlan.resistance.price, a.quote.ltp)) < 0.8); break;
  }
  if (!['gainers', 'losers', 'active', 'highVolume'].includes(state.dashboardTab)) {
    rows = sortRows(rows, state.sortKey, state.sortDir);
  }
  return pinWatchlistRows(rows, state.watchlist);
}

function pinWatchlistRows(rows, watchlist = new Set()) {
  if (!watchlist?.size) return rows;
  const pinned = [];
  const rest = [];
  rows.forEach((row, index) => {
    const bucket = watchlist.has(row.symbol) ? pinned : rest;
    bucket.push({ row, index });
  });
  pinned.sort((a, b) => {
    const ai = [...watchlist].indexOf(a.row.symbol);
    const bi = [...watchlist].indexOf(b.row.symbol);
    return ai - bi || a.index - b.index;
  });
  return [...pinned, ...rest].map((item) => item.row);
}

function sortRows(rows, key, dir) {
  const mul = dir === 'asc' ? 1 : -1;
  const getter = (a) => {
    if (key === 'symbol') return a.symbol;
    if (key === 'ltp') return a.quote.ltp;
    if (key === 'changePct') return a.quote.changePct;
    if (key === 'volume') return a.quote.volume;
    if (key === 'relVolume') return a.quote.relVolume;
    if (key === 'rsi') return a.indicators.rsi;
    if (key === 'score') return a.score;
    if (key === 'confidence') return a.confidence;
    return a.quote[key] ?? a[key] ?? 0;
  };
  return [...rows].sort((a, b) => {
    const av = getter(a); const bv = getter(b);
    if (typeof av === 'string') return av.localeCompare(bv) * mul;
    return ((av ?? 0) - (bv ?? 0)) * mul;
  });
}

function marketOverview(snapshot, provider) {
  const indexCards = snapshot.indices.map((idx) => indexCard(idx, provider.getIndexCandles(idx.symbol, '5m'))).join('');
  return `<div class="grid cols-4">${indexCards}</div>`;
}

function breadthCards(snapshot, marketRegime) {
  return `<div class="grid cols-4" style="margin-top:14px">
    <div class="card pad"><div class="metric-label">Market Breadth</div><div class="kpi-row" style="grid-template-columns: repeat(3,1fr); margin-top:10px"><div><b class="pos">${snapshot.breadth.advances}</b><br><span class="muted small">Advancing</span></div><div><b class="neg">${snapshot.breadth.declines}</b><br><span class="muted small">Declining</span></div><div><b>${snapshot.breadth.unchanged}</b><br><span class="muted small">Unchanged</span></div></div></div>
    <div class="card pad"><div class="metric-label">Advance / Decline</div><div class="metric-value num">${formatNumber(snapshot.breadth.adRatio, 2)}</div><div class="muted small">Ratio across tracked Indian equities</div></div>
    <div class="card pad"><div class="metric-label">Market Condition</div><div class="metric-value">${marketRegime.condition}</div><span class="pill ${marketRegime.condition.includes('Bull') ? 'positive' : marketRegime.condition.includes('Bear') ? 'negative' : 'warning'}">${marketRegime.trend}</span></div>
    <div class="card pad"><div class="metric-label">Volatility</div><div class="metric-value">${marketRegime.volatility}</div><div class="muted small">Avg rel vol ${formatNumber(marketRegime.relVol, 2)}x · breadth score ${formatNumber(marketRegime.score, 1)}</div></div>
  </div>`;
}

function pinnedWatchlistStrip(state) {
  const watched = [...(state.watchlist || new Set())]
    .map((symbol) => state.analyses.find((a) => a.symbol === symbol))
    .filter(Boolean);
  if (!watched.length) return '';
  return `<div class="card pinned-strip" style="margin-top:14px">
    <div class="card-header"><div><h3 class="card-title">Pinned Watchlist</h3><p class="card-subtitle">${watched.length} starred stock${watched.length === 1 ? '' : 's'} pinned in the exact order you marked them.</p></div><button class="button" data-action="dashboard-tab" data-tab="watchlist">Open Watchlist Tab</button></div>
    <div class="pinned-grid">${watched.map((a) => `<div class="pinned-tile row-click" data-action="open-stock" data-symbol="${a.symbol}">
      <div class="symbol-cell"><button class="star-btn active" data-action="watch" data-symbol="${a.symbol}" title="Remove from watchlist">★</button><div class="symbol-avatar">${a.symbol.replace(/[^A-Z]/g, '').slice(0, 3)}</div><div class="symbol-main"><b>${a.symbol}</b><span>${a.name}</span></div></div>
      <div class="pinned-tile-meta"><b>${money(a.quote.ltp)}</b><span class="${a.quote.changePct >= 0 ? 'pos' : 'neg'}">${a.quote.changePct > 0 ? '+' : ''}${formatNumber(a.quote.changePct, 2)}%</span>${signalBadge(a.signal)}</div>
    </div>`).join('')}</div>
  </div>`;
}

function tableRows(rows, state) {
  if (!rows.length) return `<tr><td colspan="17"><div class="empty-state">No stocks match the current filter. The engine prefers WAIT/NO TRADE when evidence is weak or contradictory.</div></td></tr>`;
  return rows.map((a) => {
    const q = a.quote;
    const bearish = a.signal.includes('SELL');
    const macdStatus = a.indicators.macdHist > 0 ? 'Bullish' : a.indicators.macdHist < 0 ? 'Bearish' : 'Flat';
    const watched = state.watchlist.has(q.symbol);
    return `<tr class="row-click ${watched ? 'pinned-row' : ''}" data-action="open-stock" data-symbol="${q.symbol}">
      <td>${stockSymbolCell(q, watched)}</td>
      <td><span data-live-symbol="${q.symbol}" data-field="ltp">${money(q.ltp)}</span></td>
      <td><span data-live-symbol="${q.symbol}" data-field="change">${changeHtml(q.change, q.changePct)}</span></td>
      <td>${money(q.open)}</td><td>${money(q.high)}</td><td>${money(q.low)}</td><td>${money(q.prevClose)}</td>
      <td><span data-live-symbol="${q.symbol}" data-field="volume">${compact(q.volume)}</span></td><td><span data-live-symbol="${q.symbol}" data-field="relVolume" class="num ${q.relVolume >= 1.15 ? 'pos' : q.relVolume < .75 ? 'neg' : ''}">${formatNumber(q.relVolume, 2)}x</span></td>
      <td><span data-live-symbol="${q.symbol}" data-field="vwap">${money(a.indicators.vwap)}</span></td>
      <td><span class="num ${a.indicators.rsi > 70 ? 'neg' : a.indicators.rsi < 30 ? 'pos' : ''}">${formatNumber(a.indicators.rsi, 1)}</span></td>
      <td><span class="${macdStatus === 'Bullish' ? 'pos' : macdStatus === 'Bearish' ? 'neg' : 'muted'}">${macdStatus}</span></td>
      <td><span class="${a.indicators.supertrendDirection === 'BULLISH' ? 'pos' : 'neg'}">${a.indicators.supertrendDirection}</span></td>
      <td><span data-live-symbol="${q.symbol}" data-field="signal">${signalBadge(a.signal)}</span></td><td><span data-live-symbol="${q.symbol}" data-field="confidence">${confidenceBar(a.confidence, bearish)}</span></td>
      <td><span class="pill ${a.riskLevel === 'High' ? 'warning' : 'info'}">${a.riskLevel}</span></td>
      <td><span data-live-symbol="${q.symbol}" data-field="updated" class="num tiny">${formatDateTime(q.timestamp)}</span></td>
    </tr>`;
  }).join('');
}

export function renderDashboard(state, provider) {
  const snapshot = state.snapshot;
  const rows = filterAnalyses(state.analyses, state);
  const sortIcon = (key) => state.sortKey === key ? (state.sortDir === 'asc' ? ' ↑' : ' ↓') : '';
  const actions = `<button class="button primary" data-action="route" data-route="options">Options Intelligence</button><button class="button" data-action="route" data-route="opportunities">Trade Opportunities</button>`;
  return `${pageHeader('Live Indian Market Dashboard', `Market dashboard using verified delayed Indian-market prices when available, with a real-time-ready provider architecture for official broker/vendor APIs. Tracks NIFTY 50, SENSEX and major NSE/BSE stocks with multi-indicator scoring, risk controls and stale-data protection.`, actions)}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px">
      <div>${dataPill(snapshot.status)} <span class="pill info">Last update ${formatDateTime(snapshot.timestamp)}</span> <span class="pill warning">No financial advice</span></div>
      <div class="toolbar"><input class="filter-input" style="width:280px" placeholder="Search symbol, company or sector" value="${state.search || ''}" data-input="dashboard-search" /></div>
    </div>
    ${marketOverview(snapshot, provider)}
    ${breadthCards(snapshot, state.marketRegime)}
    ${pinnedWatchlistStrip(state)}
    <div class="card" style="margin-top:14px">
      <div class="card-header">
        <div><h3 class="card-title">Market Screener</h3><p class="card-subtitle">Click any stock for complete analysis. Sorting and filters are calculated from the engine, not static labels.</p></div>
        <div class="tabs">${TABS.map(([id, label]) => `<button class="tab ${state.dashboardTab === id ? 'active' : ''}" data-action="dashboard-tab" data-tab="${id}">${label}</button>`).join('')}</div>
      </div>
      <div style="padding:16px">
        <div class="table-wrap">
          <table>
            <thead><tr>
              <th class="sortable" data-action="sort" data-sort="symbol">Stock${sortIcon('symbol')}</th>
              <th class="sortable" data-action="sort" data-sort="ltp">LTP${sortIcon('ltp')}</th>
              <th class="sortable" data-action="sort" data-sort="changePct">Change${sortIcon('changePct')}</th>
              <th>Open</th><th>High</th><th>Low</th><th>Prev Close</th>
              <th class="sortable" data-action="sort" data-sort="volume">Volume${sortIcon('volume')}</th>
              <th class="sortable" data-action="sort" data-sort="relVolume">Rel Vol${sortIcon('relVolume')}</th>
              <th>VWAP</th><th class="sortable" data-action="sort" data-sort="rsi">RSI${sortIcon('rsi')}</th><th>MACD</th><th>Supertrend</th>
              <th class="sortable" data-action="sort" data-sort="score">Signal${sortIcon('score')}</th><th class="sortable" data-action="sort" data-sort="confidence">Confidence${sortIcon('confidence')}</th><th>Risk</th><th>Updated</th>
            </tr></thead>
            <tbody>${tableRows(rows, state)}</tbody>
          </table>
        </div>
        <div class="footer-note">Showing ${rows.length} of ${state.analyses.length} stocks. Starred watchlist stocks are pinned to the top of the current list, whether you mark 1, 2, or many. Dark green = Strong Buy, green = Buy, grey = Wait/Neutral/No Trade, orange/red = Sell. ${disclaimer()}</div>
      </div>
    </div>`;
}
