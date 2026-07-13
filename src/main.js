import { DemoMarketDataProvider } from './providers/demoMarketDataProvider.js';
import { AppStore } from './store/appStore.js';
import { detectMarketRegime } from './engines/marketRegime.js';
import { analyzeUniverse } from './engines/signalEngine.js';
import { analyzeOptions } from './engines/optionsEngine.js';
import { runDemoBacktest } from './engines/backtestEngine.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderOptions, renderOptionsChain } from './pages/options.js';
import { renderOptionsAI } from './pages/optionsAI.js';
import { renderTablePage } from './pages/table.js';
import { renderScanner } from './pages/scanner.js';
import { renderOpportunities } from './pages/opportunities.js';
import { renderAIRecommendations } from './pages/aiRecommendations.js';
import { renderProTradeX } from './pages/proTradeX.js';
import { renderStockDetail } from './pages/stockDetail.js';
import { renderPerformance } from './pages/performance.js';
import { renderAlerts, renderLiveMarkets, renderSettings, renderWatchlist } from './pages/misc.js';
import { drawCandlestickChart } from './ui/chart.js';
import { dataPill, esc, formatCompact, formatDateTime, formatINR, formatNumber, formatTime, signalBadge, confidenceBar } from './ui/render.js';

const app = document.getElementById('app');
const provider = new DemoMarketDataProvider();
const store = new AppStore();
const state = store.state;

const SYMBOL_ALIASES = { TATAMOTORS: 'TMPV', ZOMATO: 'ETERNAL' };
const normalizeSymbol = (symbol) => SYMBOL_ALIASES[String(symbol || '').toUpperCase()] || symbol;
const FULL_ANALYSIS_REFRESH_MS = 5000;
const OPTIONS_ANALYSIS_REFRESH_MS = 2500;
let renderQueued = false;

const NAV = [
  ['dashboard', 'Dashboard', '▣'],
  ['pro', 'Pro Trade X', '⚡'],
  ['live', 'Live Markets', '◈'],
  ['options', 'Options Intelligence', '⌁'],
  ['options-chain', 'Options Chain', '⌬'],
  ['options-ai', 'Options AI', '▥'],
  ['table', 'Table', '▦'],
  ['scanner', 'Technical Scanner', '▤'],
  ['opportunities', 'Trade Opportunities', '◆'],
  ['ai', 'AI Recommendations', '✦'],
  ['stock', 'Stock Analysis', '◉'],
  ['performance', 'Signal Performance', '↗'],
  ['watchlist', 'Watchlist', '★'],
  ['alerts', 'Alerts', '⚑'],
  ['settings', 'Settings', '⚙']
];

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return;
  const [route, symbol] = raw.split('/');
  if (NAV.some(([id]) => id === route)) state.route = route;
  if (symbol) state.selectedSymbol = normalizeSymbol(decodeURIComponent(symbol));
}

function setRoute(route, symbol) {
  state.route = route;
  provider.setActiveRoute?.(route);
  if (symbol) state.selectedSymbol = normalizeSymbol(symbol);
  const hash = route === 'stock' && state.selectedSymbol ? `#stock/${encodeURIComponent(state.selectedSymbol)}` : `#${route}`;
  if (window.location.hash !== hash) window.location.hash = hash;
  scheduleRender();
}

function updateAnalytics(snapshot, { forceFull = false } = {}) {
  const now = Date.now();
  state.snapshot = snapshot;
  const shouldRunFullAnalysis = forceFull || !state.analyses?.length || now - (state.lastFullAnalysisAt || 0) >= FULL_ANALYSIS_REFRESH_MS;

  if (shouldRunFullAnalysis) {
    state.marketRegime = detectMarketRegime(snapshot);
    state.analyses = analyzeUniverse({
      snapshot,
      getCandles: (symbol, timeframe) => provider.getCandles(symbol, timeframe),
      marketRegime: state.marketRegime,
      timeframe: state.timeframe || '5m'
    });
    state.lastFullAnalysisAt = now;
    // Store only on throttled full-analysis cycles, not every 1-second price tick.
    state.analyses.forEach((analysis) => store.journal.record(analysis, snapshot.status));
    state.journalRows = store.journal.list();
  } else {
    const quoteMap = new Map(snapshot.stocks.map((quote) => [quote.symbol, quote]));
    state.analyses = (state.analyses || []).map((analysis) => {
      const quote = quoteMap.get(analysis.symbol);
      return quote ? { ...analysis, quote, timestamp: quote.timestamp, name: quote.name } : analysis;
    });
  }

  const shouldRunOptions = forceFull || !state.options || now - (state.lastOptionsAnalysisAt || 0) >= OPTIONS_ANALYSIS_REFRESH_MS;
  if (shouldRunOptions) {
    let instrument = state.optionsInstrument || 'NIFTY';
    let spotQuote;
    let spotCandles;
    if (String(instrument).startsWith('STOCK:')) {
      const symbol = instrument.split(':')[1];
      spotQuote = snapshot.stocks.find((s) => s.symbol === symbol);
      spotCandles = provider.getCandles(symbol, '1m');
    } else {
      const indexSymbol = instrument === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY50';
      instrument = instrument === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY';
      spotQuote = snapshot.indices.find((i) => i.symbol === indexSymbol);
      spotCandles = provider.getIndexCandles(indexSymbol, '1m');
    }
    if (spotQuote && spotCandles.length) {
      const history = state.optionsHistory[instrument] || [];
      state.options = analyzeOptions({ instrument, spotQuote, spotCandles, history });
      store.addOptionsReading(instrument, state.options.reading);
      state.lastOptionsAnalysisAt = now;
    }
  }

  state.niftyTable = provider.getNiftyOptionTableSnapshot?.() || state.niftyTable;
  if (state.niftyTable?.reading) store.addNiftyTableReading(state.niftyTable.reading);
}

function sidebar() {
  return `<aside class="sidebar">
    <div class="brand"><div class="brand-mark">TE</div><div><h1>Trade X</h1><p>Indian Market Intelligence</p></div></div>
    <div class="nav-section-title">Terminal</div>
    ${NAV.map(([id, label, icon]) => `<button class="nav-link ${state.route === id ? 'active' : ''}" data-action="route" data-route="${id}" title="${label}"><span class="nav-icon">${icon}</span><span class="nav-label">${label}</span></button>`).join('')}
    <div class="sidebar-footer"><div class="risk-note"><b>Risk notice:</b><br>Signals are probabilistic, demo data is simulated, and this is not financial advice. Use licensed data and your own judgement.</div></div>
  </aside>`;
}

function globalSearchResults() {
  const q = (state.globalSearch || '').trim().toLowerCase();
  if (!q || !state.snapshot) return '';
  const matches = state.snapshot.stocks.filter((s) => s.symbol.toLowerCase().includes(q) || s.name.toLowerCase().includes(q) || s.sector.toLowerCase().includes(q)).slice(0, 8);
  return `<div class="search-results ${matches.length ? 'open' : ''}">${matches.map((s) => `<div class="search-result" data-action="open-stock" data-symbol="${s.symbol}"><div><b>${s.symbol}</b><br><small>${s.name}</small></div><div><span class="num">₹${s.ltp}</span><br><small>${s.changePct > 0 ? '+' : ''}${s.changePct}%</small></div></div>`).join('') || '<div class="search-result"><small>No matching symbols</small></div>'}</div>`;
}

function topbar() {
  const status = state.snapshot?.status || 'DEMO';
  const updated = state.snapshot?.timestamp ? formatDateTime(state.snapshot.timestamp) : 'Starting…';
  const fetched = state.snapshot?.meta?.fetchedAt ? formatTime(state.snapshot.meta.fetchedAt) : 'Starting…';
  const marketStatus = isIndianMarketHours() ? 'Market hours' : 'Outside market hours';
  return `<header class="topbar">
    <div class="creator-credit">Made by <b>Abhishek Rulaniya</b></div>
    <div class="global-search"><input data-input="global-search" value="${esc(state.globalSearch || '')}" placeholder="Search stocks: RELIANCE, HDFCBANK, TCS…" />${globalSearchResults()}</div>
    <div class="status-strip">${dataPill(status)}<span class="pill ${isIndianMarketHours() ? 'live' : 'closed'}">${marketStatus}</span><span class="pill info">${state.marketRegime?.condition || 'Loading'}</span><span class="pill info">Market tick <span data-live-top="marketTick">${updated}</span></span><span class="pill info">Fetched <span data-live-top="fetched">${fetched}</span></span><span class="pill warning">${status === 'LIVE' ? 'Moneycontrol free live feed' : status === 'DELAYED' ? 'Moneycontrol/Yahoo delayed feed' : status === 'STALE' ? 'Stale feed' : 'Demo'}</span><span class="pill ${isIndianMarketHours() ? 'live' : 'closed'}">${isIndianMarketHours() ? 'Auto 1s' : 'Market Closed'}</span><button class="button" data-action="refresh-market">Refresh Prices</button></div>
  </header>`;
}

function isIndianMarketHours() {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  const day = ist.getDay();
  // User-requested live-analysis window starts at 09:00 IST and ends at 15:00 IST as requested.
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60;
}

function currentPage() {
  if (!state.snapshot) return '<div class="boot-loader"><div class="loader-ring"></div><h1>Connecting demo data provider…</h1></div>';
  switch (state.route) {
    case 'pro': return renderProTradeX(state);
    case 'live': return renderLiveMarkets(state);
    case 'options': return renderOptions(state);
    case 'options-chain': return renderOptionsChain(state);
    case 'options-ai': return renderOptionsAI(state, provider);
    case 'table': return renderTablePage(state);
    case 'scanner': return renderScanner(state, provider);
    case 'opportunities': return renderOpportunities(state);
    case 'ai': return renderAIRecommendations(state, provider);
    case 'stock': return renderStockDetail(state, provider);
    case 'performance': return renderPerformance(state);
    case 'watchlist': return renderWatchlist(state);
    case 'alerts': return renderAlerts(state);
    case 'settings': return renderSettings(state);
    case 'dashboard':
    default: return renderDashboard(state, provider);
  }
}

function scheduleRender() {
  if (document.hidden) return;
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

function patchLiveDom() {
  if (!state.snapshot) return;
  const stockMap = new Map(state.snapshot.stocks.map((q) => [q.symbol, q]));
  const analysisMap = new Map((state.analyses || []).map((a) => [a.symbol, a]));
  const indexMap = new Map(state.snapshot.indices.map((q) => [q.symbol, q]));
  const setClass = (el, value) => {
    el.classList.remove('pos', 'neg', 'muted', 'ref-pos', 'ref-neg');
    el.classList.add(value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted');
  };
  document.querySelectorAll('[data-live-top="marketTick"]').forEach((el) => { el.textContent = formatDateTime(state.snapshot.timestamp); });
  document.querySelectorAll('[data-live-top="fetched"]').forEach((el) => { el.textContent = state.snapshot.meta?.fetchedAt ? formatTime(state.snapshot.meta.fetchedAt) : formatTime(Date.now()); });

  document.querySelectorAll('[data-live-symbol][data-field]').forEach((el) => {
    const symbol = el.dataset.liveSymbol;
    const field = el.dataset.field;
    const q = stockMap.get(symbol);
    const a = analysisMap.get(symbol);
    if (!q) return;
    if (field === 'ltp') el.textContent = formatINR(q.ltp);
    if (field === 'change') { el.textContent = `${q.change > 0 ? '+' : ''}${formatNumber(q.change, 2)} (${q.changePct > 0 ? '+' : ''}${formatNumber(q.changePct, 2)}%)`; setClass(el, q.change); }
    if (field === 'volume') el.textContent = formatCompact(q.volume);
    if (field === 'relVolume') { el.textContent = `${formatNumber(q.relVolume, 2)}x`; setClass(el, q.relVolume - 1); }
    if (field === 'vwap') el.textContent = formatINR(a?.indicators?.vwap ?? q.vwap);
    if (field === 'signal' && a) el.innerHTML = signalBadge(a.signal);
    if (field === 'confidence' && a) el.innerHTML = confidenceBar(a.confidence, a.signal.includes('SELL'));
    if (field === 'updated') el.textContent = formatDateTime(q.timestamp);
  });

  document.querySelectorAll('[data-live-index][data-field]').forEach((el) => {
    const symbol = el.dataset.liveIndex;
    const field = el.dataset.field;
    const q = indexMap.get(symbol);
    if (!q) return;
    if (field === 'value') el.textContent = formatNumber(q.value, 2);
    if (field === 'change') { el.textContent = `${q.change > 0 ? '+' : ''}${formatNumber(q.change, 2)} (${q.changePct > 0 ? '+' : ''}${formatNumber(q.changePct, 2)}%)`; setClass(el, q.change); }
    if (field === 'high') el.textContent = formatNumber(q.dayHigh, 2);
    if (field === 'low') el.textContent = formatNumber(q.dayLow, 2);
    if (field === 'updated') el.textContent = formatDateTime(q.timestamp);
  });

  const table = state.niftyTable;
  if (table?.rows?.length) {
    const rowMap = new Map(table.rows.map((row) => [String(row.strike), row]));
    document.querySelectorAll('[data-option-side][data-strike][data-field]').forEach((el) => {
      const row = rowMap.get(el.dataset.strike);
      const leg = row?.[el.dataset.optionSide];
      if (!leg) return;
      const field = el.dataset.field;
      if (field === 'ltp') el.textContent = formatINR(leg.ltp);
      if (field === 'oi') el.textContent = formatNumber(leg.oi, 0);
      if (field === 'changeOI') { el.textContent = `${leg.changeOI > 0 ? '+' : ''}${formatNumber(leg.changeOI, 0)}`; setClass(el, leg.changeOI); }
      if (field === 'oiPct') { el.textContent = `${leg.oiPct > 0 ? '+' : ''}${formatNumber(leg.oiPct, 2)}%`; setClass(el, leg.oiPct); }
    });
    document.querySelectorAll('[data-table-total]').forEach((el) => {
      const key = el.dataset.tableTotal;
      if (Number.isFinite(table.totals?.[key])) el.textContent = formatNumber(table.totals[key], 0);
    });
  }
}

function render() {
  const active = document.activeElement;
  const activeInput = active?.dataset?.input;
  const caret = active && typeof active.selectionStart === 'number' ? active.selectionStart : null;
  app.className = '';
  app.innerHTML = `<div class="shell ${state.sidebarCollapsed ? 'sidebar-collapsed' : ''}">${sidebar()}<button class="sidebar-toggle" data-action="toggle-sidebar" title="${state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}" aria-label="${state.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}">${state.sidebarCollapsed ? '›' : '‹'}</button><main class="main">${topbar()}<section class="content">${currentPage()}</section></main></div>`;
  requestAnimationFrame(() => {
    if (activeInput) {
      const next = document.querySelector(`[data-input="${activeInput}"]`);
      if (next) {
        next.focus();
        if (caret !== null) next.setSelectionRange(caret, caret);
      }
    }
    document.querySelectorAll('canvas[data-chart="stock"]').forEach((canvas) => {
      const symbol = canvas.dataset.symbol;
      const timeframe = canvas.dataset.timeframe || state.timeframe || '5m';
      const candles = provider.getCandles(symbol, timeframe);
      drawCandlestickChart(canvas, candles, state.currentDetailAnalysis);
    });
  });
}

app.addEventListener('click', (event) => {
  const el = event.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'toggle-sidebar') {
    store.setSidebarCollapsed(!state.sidebarCollapsed);
    render();
    return;
  }
  if (action === 'route') setRoute(el.dataset.route);
  if (action === 'open-stock') setRoute('stock', el.dataset.symbol);
  if (action === 'watch') {
    event.stopPropagation();
    store.toggleWatchlist(el.dataset.symbol);
    render();
  }
  if (action === 'dashboard-tab') {
    state.dashboardTab = el.dataset.tab;
    render();
  }
  if (action === 'sort') {
    const key = el.dataset.sort;
    if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
    else { state.sortKey = key; state.sortDir = ['symbol'].includes(key) ? 'asc' : 'desc'; }
    render();
  }
  if (action === 'scanner-timeframe') {
    state.scannerTimeframe = el.dataset.timeframe;
    state.scannerCache = null;
    render();
  }
  if (action === 'table-timeframe') {
    state.tableTimeframe = Number(el.dataset.minutes || 5);
    render();
  }
  if (action === 'ai-filter') {
    state.aiFilter = el.dataset.filter || 'all';
    render();
  }
  if (action === 'table-sort') {
    const side = el.dataset.side;
    const key = el.dataset.sort;
    const current = state.tableSort || { side, key, dir: 'asc' };
    const dir = current.side === side && current.key === key && current.dir === 'asc' ? 'desc' : 'asc';
    state.tableSort = { side, key, dir };
    render();
  }
  if (action === 'detail-timeframe') {
    state.timeframe = el.dataset.timeframe;
    updateAnalytics(state.snapshot, { forceFull: true });
    render();
  }
  if (action === 'options-instrument' || action === 'select-stock-option') {
    state.optionsInstrument = el.dataset.instrument;
    // User changed the underlying. Force recalculation immediately so Options AI
    // never shows the previously selected stock/strike for one refresh cycle.
    updateAnalytics(state.snapshot, { forceFull: true });
    render();
  }
  if (action === 'refresh-market') {
    el.textContent = 'Refreshing…';
    Promise.all([
      provider.refreshFromNetwork({ silent: false, force: true }),
      state.route === 'table' ? provider.refreshNiftyOptionTable({ silent: false, force: true }) : Promise.resolve(false)
    ]).then((results) => {
      updateAnalytics(provider.getSnapshot(), { forceFull: true });
      scheduleRender();
      if (!results.some(Boolean)) console.warn('No fresh frontend quote refresh was available.');
    });
  }
  if (action === 'run-demo-backtest') {
    const symbol = state.selectedSymbol || 'RELIANCE';
    const quote = state.snapshot.stocks.find((s) => s.symbol === symbol) || state.snapshot.stocks[0];
    state.demoBacktest = runDemoBacktest({ quote, candles: provider.getCandles(quote.symbol, '5m'), marketRegime: state.marketRegime, timeframe: '5m' });
    render();
  }
  if (action === 'clear-journal') {
    store.clearJournal();
    state.journalRows = store.journal.list();
    render();
  }
});

function handleDataInput(input) {
  if (!input) return false;
  if (input.dataset.input === 'dashboard-search') state.search = input.value;
  else if (input.dataset.input === 'global-search') state.globalSearch = input.value;
  else if (input.dataset.input === 'stock-option-select') {
    state.optionsInstrument = input.value;
    // Force immediate underlying switch for Options AI / Options Chain. Without
    // this, the throttled options engine can show the previous stock briefly.
    updateAnalytics(state.snapshot, { forceFull: true });
  }
  else if (input.dataset.input === 'table-strike-search') state.tableSearch = input.value;
  else if (input.dataset.input === 'pro-capital') state.proCapital = input.value;
  else if (input.dataset.input === 'pro-risk') state.proRiskPct = input.value;
  else if (input.dataset.input === 'pro-symbol') state.proRiskSymbol = input.value;
  else return false;
  return true;
}

app.addEventListener('input', (event) => {
  const input = event.target.closest('[data-input]');
  if (handleDataInput(input)) render();
});

app.addEventListener('change', (event) => {
  const input = event.target.closest('[data-input]');
  // Some browsers fire change, not input, for select controls. This guarantees
  // stock/index option selection updates immediately.
  if (input?.dataset.input === 'stock-option-select' && handleDataInput(input)) render();
});

window.addEventListener('hashchange', () => { parseHash(); provider.setActiveRoute?.(state.route); scheduleRender(); });
window.addEventListener('resize', () => {
  document.querySelectorAll('canvas[data-chart="stock"]').forEach((canvas) => {
    const symbol = canvas.dataset.symbol;
    drawCandlestickChart(canvas, provider.getCandles(symbol, canvas.dataset.timeframe || state.timeframe), state.currentDetailAnalysis);
  });
});

parseHash();
provider.setActiveRoute?.(state.route);
let initialRenderComplete = false;
provider.subscribe((snapshot) => {
  updateAnalytics(snapshot);
  if (!initialRenderComplete) {
    initialRenderComplete = true;
    render();
  } else {
    patchLiveDom();
  }
});
provider.connect();
