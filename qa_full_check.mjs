import { DemoMarketDataProvider } from '../src/providers/demoMarketDataProvider.js';
import { detectMarketRegime } from '../src/engines/marketRegime.js';
import { analyzeStock, analyzeUniverse } from '../src/engines/signalEngine.js';
import { analyzeOptions } from '../src/engines/optionsEngine.js';
import { runDemoBacktest } from '../src/engines/backtestEngine.js';
import { STOCK_UNIVERSE } from '../src/data/universe.js';
import { LIVE_SNAPSHOT } from '../src/data/liveSnapshot.js';
import { renderDashboard } from '../src/pages/dashboard.js';
import { renderOptions, renderOptionsChain } from '../src/pages/options.js';
import { renderOptionsAI } from '../src/pages/optionsAI.js';
import { renderScanner } from '../src/pages/scanner.js';
import { renderTablePage } from '../src/pages/table.js';
import { renderOpportunities } from '../src/pages/opportunities.js';
import { renderAIRecommendations } from '../src/pages/aiRecommendations.js';
import { renderProTradeX } from '../src/pages/proTradeX.js';
import { renderStockDetail } from '../src/pages/stockDetail.js';
import { renderPerformance } from '../src/pages/performance.js';
import { renderAlerts, renderLiveMarkets, renderSettings, renderWatchlist } from '../src/pages/misc.js';

const failures = [];
const warnings = [];
const pass = (name) => console.log(`PASS ${name}`);
const fail = (name, detail) => { failures.push({ name, detail }); console.error(`FAIL ${name}: ${detail}`); };
const warn = (name, detail) => { warnings.push({ name, detail }); console.warn(`WARN ${name}: ${detail}`); };
const assert = (cond, name, detail = '') => cond ? pass(name) : fail(name, detail);

const provider = new DemoMarketDataProvider();
await provider.refreshNiftyOptionTable({ force: true, silent: true });
const snapshot = provider.getSnapshot();
const regime = detectMarketRegime(snapshot);
const analyses = analyzeUniverse({ snapshot, getCandles: (s,t) => provider.getCandles(s,t), marketRegime: regime, timeframe: '5m' });
const indexSymbol = 'NIFTY50';
const spotQuote = snapshot.indices.find(i => i.symbol === indexSymbol);
const options = analyzeOptions({ instrument: 'NIFTY', spotQuote, spotCandles: provider.getIndexCandles(indexSymbol, '1m'), history: [] });
const state = {
  route: 'dashboard', selectedSymbol: 'RELIANCE', timeframe: '5m', dashboardTab: 'all', scannerTimeframe: '15m', search: '', sortKey: 'changePct', sortDir: 'desc', optionsInstrument: 'NIFTY',
  watchlist: new Set(['RELIANCE', 'HDFCBANK', 'INFY']), aiFilter: 'all', alerts: [{ id: 'qa', symbol: 'NIFTY', condition: 'QA test', status: 'Demo armed' }], snapshot, marketRegime: regime, analyses, options, optionsHistory: { NIFTY: [options.reading], BANKNIFTY: [] }, niftyTable: provider.getNiftyOptionTableSnapshot(), niftyTableHistory: [provider.getNiftyOptionTableSnapshot()?.reading].filter(Boolean), tableTimeframe: 5, tableSearch: '', tableSort: { side: 'call', key: 'strike', dir: 'asc' }, demoBacktest: null, settings: { staleSeconds: 15 }, journalRows: []
};

assert(snapshot.status === 'DELAYED', 'data status is delayed verified snapshot', `got ${snapshot.status}`);
assert(LIVE_SNAPSHOT.validation?.ok === true, 'live snapshot validation flag ok', JSON.stringify(LIVE_SNAPSHOT.validation));
assert(snapshot.stocks.length === STOCK_UNIVERSE.length, 'stock universe count matches provider count', `${snapshot.stocks.length}/${STOCK_UNIVERSE.length}`);
assert(STOCK_UNIVERSE.filter(s => s.indices.includes('NIFTY50')).length === 50, 'NIFTY50 universe contains 50 symbols');
assert(STOCK_UNIVERSE.filter(s => s.indices.includes('SENSEX')).length === 30, 'SENSEX universe contains 30 symbols');
assert(STOCK_UNIVERSE.filter(s => s.indices.includes('BANKNIFTY')).length === 14, 'NIFTY BANK universe contains 14 symbols');
assert(snapshot.indices.length === 4, 'index cards count is 4');
for (const sym of ['NIFTY50','SENSEX','BANKNIFTY','INDIAVIX']) {
  const idx = snapshot.indices.find(i => i.symbol === sym);
  assert(!!idx && Number.isFinite(idx.value) && idx.value > 0, `index ${sym} has valid value`, JSON.stringify(idx));
}
for (const sym of ['RELIANCE','HDFCBANK','ICICIBANK','INFY','TCS','TMPV','ETERNAL']) {
  const q = snapshot.stocks.find(s => s.symbol === sym);
  assert(!!q && Number.isFinite(q.ltp) && q.ltp > 0, `stock ${sym} has valid LTP`, JSON.stringify(q));
  assert(q.dataStatus === 'DELAYED', `stock ${sym} data status delayed`, q?.dataStatus);
  assert(provider.getCandles(sym, '5m').length >= 20, `stock ${sym} has candles`, provider.getCandles(sym, '5m').length);
}
assert(analyses.length === snapshot.stocks.length, 'analysis generated for every stock');
for (const a of analyses) {
  assert(Number.isFinite(a.score), `score finite ${a.symbol}`, String(a.score));
  assert(Number.isFinite(a.confidence), `confidence finite ${a.symbol}`, String(a.confidence));
  assert(a.signal && !String(a.signal).includes('undefined'), `signal present ${a.symbol}`, String(a.signal));
  assert(a.riskPlan && Number.isFinite(a.riskPlan.rr), `risk plan present ${a.symbol}`, JSON.stringify(a.riskPlan));
}
assert(options.chain.rows.length === 17, 'options chain has 17 strikes');
assert(Number.isFinite(options.totals.pcr) && options.totals.pcr > 0, 'PCR valid');
assert(options.reading.explanation.length > 20, 'options reading explanation present');
const optionsHtmlForPcr = renderOptions(state);
assert(optionsHtmlForPcr.includes('Put/Call Ratio (PCR)'), 'Options page shows Put/Call Ratio heading');
assert(optionsHtmlForPcr.includes('Total Put OI') && optionsHtmlForPcr.includes('Total Call OI'), 'Options page shows PCR formula inputs');
assert(optionsHtmlForPcr.includes(options.totals.pcr.toFixed(2)) || optionsHtmlForPcr.includes(String(options.totals.pcr)), 'Options page shows current PCR value');
assert(optionsHtmlForPcr.includes('NIFTY 50 Stock Options Universe'), 'Options page shows NIFTY 50 stock options universe');
assert(optionsHtmlForPcr.includes('P/E Ratio'), 'Options stock universe shows P/E Ratio column');
assert(optionsHtmlForPcr.includes('CE') && optionsHtmlForPcr.includes('PE'), 'Options stock universe shows CE and PE option types');
const stockOption = analyzeOptions({ instrument: 'STOCK:RELIANCE', spotQuote: snapshot.stocks.find((s) => s.symbol === 'RELIANCE'), spotCandles: provider.getCandles('RELIANCE', '1m'), history: [] });
assert(stockOption.config.type === 'STOCK' && stockOption.chain.rows.length === 17 && Number.isFinite(stockOption.totals.pcr), 'Stock option chain works for NIFTY 50 stock underlying');
const optionsChainHtmlForQa = renderOptionsChain(state);
assert(optionsHtmlForPcr.includes('Open Option Chain & Signal History') && optionsChainHtmlForQa.includes('CALL OPTION TABLE') && optionsChainHtmlForQa.includes('PUT OPTION TABLE'), 'Options Intelligence is split into overview and chain pages');
const optionsAIHtmlForQa = renderOptionsAI(state, provider);
assert(optionsAIHtmlForQa.includes('BUY CE') && optionsAIHtmlForQa.includes('BUY PE') && optionsAIHtmlForQa.includes('SELL CE') && optionsAIHtmlForQa.includes('SELL PE'), 'Options AI page shows four strategy cards');
assert(optionsAIHtmlForQa.includes('AI BEST CHOICE') && optionsAIHtmlForQa.includes('How to choose the correct option?') && optionsAIHtmlForQa.includes('20-Indicator Technical Confirmation'), 'Options AI ranks the best contract using 20 indicators and option confirmations');
assert(optionsAIHtmlForQa.includes('Total Call OI Change') && optionsAIHtmlForQa.includes('Total Put OI Change') && optionsAIHtmlForQa.includes('PCR (Put / Call Ratio)'), 'Options AI shows PCR, total call OI change and total put OI change above cards');
assert(/NIFTY [0-9]+ CE/.test(optionsAIHtmlForQa) && /NIFTY [0-9]+ PE/.test(optionsAIHtmlForQa), 'Options AI page shows exact NIFTY CE and PE contract names');
const nifty50OptionContractFailures = STOCK_UNIVERSE.filter((stock) => stock.indices.includes('NIFTY50')).filter((stock) => {
  const quote = snapshot.stocks.find((s) => s.symbol === stock.symbol);
  if (!quote) return true;
  const stockOptions = analyzeOptions({ instrument: `STOCK:${stock.symbol}`, spotQuote: quote, spotCandles: provider.getCandles(stock.symbol, '1m'), history: [] });
  const html = renderOptionsAI({ ...state, options: stockOptions, optionsInstrument: `STOCK:${stock.symbol}` }, provider);
  return !(html.includes(`${stock.symbol} `) && html.includes(' CE') && html.includes(' PE') && html.includes('Exact contract'));
});
assert(nifty50OptionContractFailures.length === 0, 'Options AI exact CE/PE contract names work for every NIFTY 50 stock', nifty50OptionContractFailures.join(','));
assert(state.niftyTable?.rows?.length >= 50, 'Table page has live NIFTY option-chain rows', String(state.niftyTable?.rows?.length));
assert(Number.isFinite(state.niftyTable?.totals?.totalCallOI) && Number.isFinite(state.niftyTable?.totals?.totalPutOI), 'Table page totals are calculated');
const tableHtmlForQa = renderTablePage(state);
assert(tableHtmlForQa.includes('Call Option Table') && tableHtmlForQa.includes('Put Option Table'), 'Table page shows separate CALL and PUT tables');
assert(tableHtmlForQa.includes('PCR') && tableHtmlForQa.includes('VWAP') && tableHtmlForQa.includes('Live Market Signal Table'), 'Table page shows signal table PCR and VWAP columns');
assert(tableHtmlForQa.includes('Intraday Put/Call Ratio Table') && tableHtmlForQa.includes('Put/Call Ratio') && tableHtmlForQa.includes('PCR Change'), 'Table page shows dedicated intraday PCR table');
assert(tableHtmlForQa.includes('PCR Signal') && tableHtmlForQa.includes('PCR &lt; 1 = SELL') && tableHtmlForQa.includes('PCR ≥ 2 = STRONG BUY'), 'Table PCR section shows requested PCR signal rules');
assert(tableHtmlForQa.includes('5 Minutes') && tableHtmlForQa.includes('15 Minutes'), 'Table PCR section supports 5 and 15 minute intervals');
const scannerHtmlForQa = renderScanner(state, provider);
assert(scannerHtmlForQa.includes('Entry Price') && scannerHtmlForQa.includes('Stop Loss') && scannerHtmlForQa.includes('Targets') && scannerHtmlForQa.includes('PCR'), 'Technical Scanner shows PCR, entry, stop loss and target columns');
const stockDetailHtmlForQa = renderStockDetail(state, provider);
assert(stockDetailHtmlForQa.includes('Technical Analysis') && stockDetailHtmlForQa.includes('Signal Distribution') && stockDetailHtmlForQa.includes('Williams %R') && stockDetailHtmlForQa.includes('Fibonacci'), 'Stock detail shows 20-indicator technical analysis matrix');
assert(stockDetailHtmlForQa.includes('Buy/Sell Zones') && stockDetailHtmlForQa.includes('Aggressive') && stockDetailHtmlForQa.includes('Ideal') && stockDetailHtmlForQa.includes('Conservative') && stockDetailHtmlForQa.includes('Risk:Reward'), 'Stock detail shows live buy/sell zone cards for every timeframe');

const pages = {
  dashboard: () => renderDashboard(state, provider),
  proTradeX: () => renderProTradeX(state),
  live: () => renderLiveMarkets(state),
  options: () => renderOptions(state),
  optionsChain: () => renderOptionsChain(state),
  optionsAI: () => renderOptionsAI(state, provider),
  table: () => renderTablePage(state),
  scanner: () => renderScanner(state, provider),
  opportunities: () => renderOpportunities(state),
  aiRecommendations: () => renderAIRecommendations(state, provider),
  stockDetail: () => renderStockDetail(state, provider),
  performance: () => renderPerformance(state),
  watchlist: () => renderWatchlist(state),
  alerts: () => renderAlerts(state),
  settings: () => renderSettings(state)
};
for (const [name, fn] of Object.entries(pages)) {
  try {
    const html = fn();
    assert(typeof html === 'string' && html.length > 500, `render ${name} returns substantial HTML`, String(html.length));
    if (/\bundefined\b/.test(html)) fail(`render ${name} no undefined`, 'HTML contains undefined'); else pass(`render ${name} no undefined`);
    if (/\bNaN\b/.test(html)) fail(`render ${name} no NaN`, 'HTML contains NaN'); else pass(`render ${name} no NaN`);
    if (/\[object Object\]/.test(html)) fail(`render ${name} no object string`, 'HTML contains [object Object]'); else pass(`render ${name} no object string`);
  } catch (e) {
    fail(`render ${name}`, e.stack || e.message || String(e));
  }
}

function firstOpenStockSymbols(html, count = 4) {
  return [...html.matchAll(/<tr class="row-click[^"]*" data-action="open-stock" data-symbol="([^"]+)"/g)].slice(0, count).map((m) => m[1]);
}
const expectedPinned = ['RELIANCE', 'HDFCBANK', 'INFY'];
const dashboardPinned = firstOpenStockSymbols(renderDashboard(state, provider), 3);
assert(expectedPinned.every((symbol, index) => dashboardPinned[index] === symbol), 'dashboard pins all starred watchlist stocks at top', dashboardPinned.join(','));
const scannerPinned = firstOpenStockSymbols(renderScanner(state, provider), 3);
assert(expectedPinned.every((symbol, index) => scannerPinned[index] === symbol), 'scanner pins all starred watchlist stocks at top', scannerPinned.join(','));
const watchlistPinned = firstOpenStockSymbols(renderWatchlist(state), 3);
assert(expectedPinned.every((symbol, index) => watchlistPinned[index] === symbol), 'watchlist page preserves starred order for all marked symbols', watchlistPinned.join(','));
state.dashboardTab = 'watchlist';
const dashboardWatchlistTabPinned = firstOpenStockSymbols(renderDashboard(state, provider), 3);
assert(expectedPinned.every((symbol, index) => dashboardWatchlistTabPinned[index] === symbol), 'dashboard watchlist tab shows all starred symbols at top', dashboardWatchlistTabPinned.join(','));
state.dashboardTab = 'all';

for (const tf of ['1m','5m','15m','30m','1h','1d','1w']) {
  const candles = provider.getCandles('RELIANCE', tf);
  const len = candles.length;
  const minLen = tf === '1d' ? 120 : tf === '1w' ? 24 : 1;
  assert(len >= minLen, `timeframe ${tf} candles available`, `${len}/${minLen}`);
  const tfAnalysis = analyzeStock({ quote: snapshot.stocks.find(s => s.symbol === 'RELIANCE'), candles, marketRegime: regime, dataStatus: snapshot.status, timeframe: tf });
  assert(Number.isFinite(tfAnalysis.score) && Number.isFinite(tfAnalysis.confidence) && tfAnalysis.signal, `timeframe ${tf} analysis works`, `${tfAnalysis.signal} ${tfAnalysis.score}`);
}

const bt = runDemoBacktest({ quote: snapshot.stocks.find(s => s.symbol === 'RELIANCE'), candles: provider.getCandles('RELIANCE', '5m'), marketRegime: regime, timeframe: '5m' });
assert(bt && Number.isFinite(bt.totalSignals), 'demo backtest runs');

const sensexCount = STOCK_UNIVERSE.filter(s => s.indices.includes('SENSEX')).length;
if (sensexCount !== 30) warn('SENSEX universe count', `currently ${sensexCount}; BSE SENSEX should be 30 if exact constituent mode is required`); else pass('SENSEX universe contains 30 symbols');

console.log(JSON.stringify({ ok: failures.length === 0, failures, warnings, summary: { stocks: snapshot.stocks.length, analyses: analyses.length, pages: Object.keys(pages).length, dataStatus: snapshot.status } }, null, 2));
if (failures.length) process.exit(1);
