import { compact, confidenceBar, dataPill, disclaimer, money, pageHeader, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';
import { directionClass, percentDistance } from '../core/utils.js';

function groupBy(list, keyFn) {
  return list.reduce((acc, item) => {
    const key = keyFn(item);
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

function avg(values) {
  const clean = values.filter(Number.isFinite);
  return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
}

function side(signal = '') {
  if (signal.includes('BUY')) return 1;
  if (signal.includes('SELL')) return -1;
  return 0;
}

function proSummary(state) {
  const sectors = sectorRows(state).slice(0, 3);
  const vix = state.snapshot.indices.find((i) => i.symbol === 'INDIAVIX')?.value;
  const regime = state.marketRegime;
  const buyCount = state.analyses.filter((a) => a.signal.includes('BUY')).length;
  const sellCount = state.analyses.filter((a) => a.signal.includes('SELL')).length;
  const waitCount = state.analyses.length - buyCount - sellCount;
  const topSector = sectors[0];
  const caution = vix > 18 ? 'Volatility is elevated; position size should be reduced.' : 'Volatility filter is normal.';
  return `<div class="card pro-summary-card">
    <div class="card-header"><div><h3 class="card-title">AI Market Summary</h3><p class="card-subtitle">Live market interpretation using breadth, sector strength, VIX, VWAP context and signal distribution.</p></div>${dataPill(state.snapshot.status)}</div>
    <div class="pro-summary-body">
      <p><b>${regime.condition}</b> market regime with <b>${regime.volatility}</b> volatility. Breadth ratio is <b>${formatNumber(regime.breadth, 2)}</b>.</p>
      <p>Signal distribution: <span class="pos">${buyCount} bullish</span>, <span class="neg">${sellCount} bearish</span>, ${waitCount} wait/neutral.</p>
      <p>Leading sector: <b>${topSector?.sector || '—'}</b> (${topSector ? formatNumber(topSector.avgChange, 2) : '—'}%). ${caution}</p>
      <p class="muted small">This is probabilistic decision support, not financial advice. Official live reliability requires the Render + Upstox backend.</p>
    </div>
  </div>`;
}

function sectorRows(state) {
  const grouped = groupBy(state.analyses, (a) => a.quote.sector || 'Other');
  return Object.entries(grouped).map(([sector, rows]) => {
    const avgChange = avg(rows.map((a) => a.quote.changePct));
    const avgScore = avg(rows.map((a) => a.score));
    const relVol = avg(rows.map((a) => a.quote.relVolume));
    const buy = rows.filter((a) => a.signal.includes('BUY')).length;
    const sell = rows.filter((a) => a.signal.includes('SELL')).length;
    return { sector, count: rows.length, avgChange, avgScore, relVol, buy, sell, signal: avgScore > 25 ? 'BUY' : avgScore < -25 ? 'SELL' : 'NEUTRAL' };
  }).sort((a, b) => b.avgScore - a.avgScore);
}

function sectorStrength(state) {
  const rows = sectorRows(state);
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Sector Strength Dashboard</h3><p class="card-subtitle">Ranks sectors by average score, change, signal count and relative volume.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Sector</th><th>Stocks</th><th>Avg Change</th><th>Avg Score</th><th>Rel Vol</th><th>Bullish</th><th>Bearish</th><th>Signal</th></tr></thead><tbody>${rows.map((r) => `<tr><td><b>${r.sector}</b></td><td>${r.count}</td><td><span class="num ${directionClass(r.avgChange)}">${formatNumber(r.avgChange, 2)}%</span></td><td><span class="num ${directionClass(r.avgScore)}">${formatNumber(r.avgScore, 1)}</span></td><td><span class="num">${formatNumber(r.relVol, 2)}x</span></td><td class="pos">${r.buy}</td><td class="neg">${r.sell}</td><td>${signalBadge(r.signal)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

function dataHealth(state) {
  const meta = state.snapshot.meta || {};
  const failures = meta.validation?.failures?.length || 0;
  const freshness = meta.freshnessMs ? Math.round(meta.freshnessMs / 1000) : 0;
  const tableSource = state.niftyTable?.source || 'No option table source yet';
  return `<div class="card pro-health-card"><div class="card-header"><div><h3 class="card-title">Data Health Monitor</h3><p class="card-subtitle">Tracks feed status, freshness, failures and active source.</p></div></div><div class="pro-health-grid">
    <div><span>Status</span>${dataPill(state.snapshot.status)}</div>
    <div><span>Provider</span><b>${meta.provider || 'Browser provider'}</b></div>
    <div><span>Freshness</span><b>${freshness}s</b></div>
    <div><span>Universe</span><b>${meta.universeSize || state.snapshot.stocks.length}</b></div>
    <div><span>Failures</span><b class="${failures ? 'neg' : 'pos'}">${failures}</b></div>
    <div><span>Option Source</span><b>${tableSource.includes('Upstox') ? 'Upstox Official' : tableSource.includes('Groww') ? 'Groww fallback' : 'Fallback/embedded'}</b></div>
  </div></div>`;
}

function optionHeatmap(state) {
  const table = state.niftyTable;
  if (!table?.rows?.length) return `<div class="empty-state">Option heatmap waiting for NIFTY option table data.</div>`;
  const atm = table.atmStrike;
  const near = table.rows.filter((r) => Math.abs(r.strike - atm) <= 500);
  const maxCall = Math.max(...near.map((r) => r.call.oi), 1);
  const maxPut = Math.max(...near.map((r) => r.put.oi), 1);
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Advanced Option Chain Heatmap</h3><p class="card-subtitle">Call OI, Put OI, OI change concentration and ATM support/resistance zones.</p></div><span class="pill info">ATM ${atm}</span></div><div class="option-heatmap">${near.map((r) => `<div class="heat-row ${r.strike === atm ? 'atm' : ''}"><span>${r.strike}</span><div class="heat-cell call" style="--w:${(r.call.oi / maxCall) * 100}%"><b>${compact(r.call.oi)}</b><small>${r.call.changeOI > 0 ? '+' : ''}${formatNumber(r.call.changeOI, 0)}</small></div><div class="heat-cell put" style="--w:${(r.put.oi / maxPut) * 100}%"><b>${compact(r.put.oi)}</b><small>${r.put.changeOI > 0 ? '+' : ''}${formatNumber(r.put.changeOI, 0)}</small></div></div>`).join('')}</div></div>`;
}

function riskCalculator(state) {
  const capital = Number(state.proCapital || 100000);
  const riskPct = Number(state.proRiskPct || 1);
  const symbol = state.proRiskSymbol || state.selectedSymbol || state.analyses[0]?.symbol;
  const analysis = state.analyses.find((a) => a.symbol === symbol) || state.analyses[0];
  const stop = analysis?.riskPlan?.standardStop;
  const price = analysis?.quote?.ltp;
  const riskPerShare = Math.max(0.01, Math.abs(price - stop));
  const maxRisk = capital * riskPct / 100;
  const qty = Math.max(0, Math.floor(maxRisk / riskPerShare));
  const exposure = qty * price;
  const options = state.analyses.slice().sort((a, b) => a.symbol.localeCompare(b.symbol)).map((a) => `<option value="${a.symbol}" ${a.symbol === symbol ? 'selected' : ''}>${a.symbol}</option>`).join('');
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Risk Calculator / Position Sizing</h3><p class="card-subtitle">Calculates quantity from capital, risk %, live price and adaptive stop-loss.</p></div></div><div class="risk-calc-grid">
    <label>Capital<input class="filter-input" data-input="pro-capital" value="${capital}" /></label>
    <label>Risk %<input class="filter-input" data-input="pro-risk" value="${riskPct}" /></label>
    <label>Symbol<select class="select" data-input="pro-symbol">${options}</select></label>
    <div><span>Live Price</span><b>${money(price)}</b></div>
    <div><span>Stop Loss</span><b class="neg">${money(stop)}</b></div>
    <div><span>Risk / Share</span><b>${money(riskPerShare)}</b></div>
    <div><span>Quantity</span><b class="pos">${qty}</b></div>
    <div><span>Max Risk</span><b>${money(maxRisk)}</b></div>
    <div><span>Exposure</span><b>${money(exposure)}</b></div>
  </div></div>`;
}

function proWatchlist(state) {
  const rows = [...(state.watchlist || new Set())].map((symbol) => state.analyses.find((a) => a.symbol === symbol)).filter(Boolean);
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Pro Watchlist Panel</h3><p class="card-subtitle">Pinned symbols with live signal and risk summary.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>LTP</th><th>Signal</th><th>Confidence</th><th>Entry</th><th>SL</th><th>Target</th></tr></thead><tbody>${rows.map((a) => `<tr data-action="open-stock" data-symbol="${a.symbol}" class="row-click"><td><b>${a.symbol}</b><br><span class="muted small">${a.name}</span></td><td>${money(a.quote.ltp)}</td><td>${signalBadge(a.signal)}</td><td>${confidenceBar(a.confidence, a.signal.includes('SELL'))}</td><td>${a.riskPlan.entryLow ? `${money(a.riskPlan.entryLow)}-${money(a.riskPlan.entryHigh)}` : '—'}</td><td>${a.riskPlan.standardStop ? money(a.riskPlan.standardStop) : '—'}</td><td>${a.riskPlan.target1 ? money(a.riskPlan.target1) : '—'}</td></tr>`).join('') || '<tr><td colspan="7"><div class="empty-state">No watchlist symbols.</div></td></tr>'}</tbody></table></div></div></div>`;
}

function avoidDetector(state) {
  const rows = state.analyses.filter((a) => a.signal === 'NO TRADE' || a.warnings?.length || a.riskPlan.rr < 1.5 || a.quote.relVolume < 0.7).slice(0, 10);
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Avoid Trade Detector</h3><p class="card-subtitle">Flags poor risk/reward, low volume, stale/conflicting setups and overextension.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Reason</th><th>R/R</th><th>Rel Vol</th><th>Signal</th></tr></thead><tbody>${rows.map((a) => `<tr><td><b>${a.symbol}</b></td><td style="white-space:normal;min-width:280px">${[...(a.warnings || []), a.riskPlan.rr < 1.5 ? 'Poor risk/reward' : '', a.quote.relVolume < 0.7 ? 'Weak volume' : ''].filter(Boolean).slice(0, 2).join(' · ') || 'Quality control warning'}</td><td>${formatNumber(a.riskPlan.rr, 2)}:1</td><td>${formatNumber(a.quote.relVolume, 2)}x</td><td>${signalBadge(a.signal)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

function strategyBuilder(state) {
  const pcr = state.niftyTable?.reading?.pcr || state.options?.totals?.pcr || 1;
  const vix = state.snapshot.indices.find((i) => i.symbol === 'INDIAVIX')?.value || 14;
  const trend = state.marketRegime.trend;
  const strategy = vix > 18 ? 'Iron Condor / Defined Risk Spreads' : trend.includes('Up') && pcr > 1 ? 'Bull Call Spread / Buy Call' : trend.includes('Down') && pcr < 1 ? 'Bear Put Spread / Buy Put' : 'Short Strangle only for experts / Wait';
  return `<div class="card pad"><h3 class="card-title">Options Strategy Builder</h3><p class="card-subtitle">Suggested strategy from IV, trend, PCR and volatility.</p><div class="metric-value" style="font-size:24px">${strategy}</div><ul class="explain-list"><li class="info">PCR ${formatNumber(pcr, 2)} · VIX ${formatNumber(vix, 2)} · Regime ${trend}</li><li class="warn">Use only after checking liquidity, margin and risk.</li></ul></div>`;
}

function modePanels(state) {
  const scalps = state.analyses.filter((a) => Math.abs(a.score) >= 35 && a.quote.relVolume >= 0.9).sort((a, b) => b.confidence - a.confidence).slice(0, 5);
  const swings = state.analyses.filter((a) => ['BUY', 'STRONG BUY', 'SELL', 'STRONG SELL'].includes(a.signal) && a.riskPlan.rr >= 1.8).sort((a, b) => b.riskPlan.rr - a.riskPlan.rr).slice(0, 5);
  const list = (rows) => rows.map((a) => `<tr><td>${a.symbol}</td><td>${signalBadge(a.signal)}</td><td>${money(a.quote.ltp)}</td><td>${formatNumber(a.confidence, 0)}%</td><td>${formatNumber(a.riskPlan.rr, 2)}:1</td></tr>`).join('');
  return `<div class="grid cols-2"><div class="card"><div class="card-header"><div><h3 class="card-title">Scalping Mode</h3><p class="card-subtitle">Fast 1m/5m momentum candidates.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Signal</th><th>LTP</th><th>Conf</th><th>R/R</th></tr></thead><tbody>${list(scalps)}</tbody></table></div></div></div><div class="card"><div class="card-header"><div><h3 class="card-title">Swing Mode</h3><p class="card-subtitle">1–3 day candidates with better structure.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Signal</th><th>LTP</th><th>Conf</th><th>R/R</th></tr></thead><tbody>${list(swings)}</tbody></table></div></div></div></div>`;
}

function alertsAndJournal(state) {
  const journal = (state.journalRows || []).slice(0, 8).map((r) => `<tr><td>${r.symbol}</td><td>${signalBadge(r.signal)}</td><td>${money(r.entry)}</td><td>${money(r.stopLoss)}</td><td>${formatDateTime(r.timestamp)}</td><td>${r.result}</td></tr>`).join('');
  return `<div class="grid cols-2"><div class="card pad"><h3 class="card-title">Alert Center</h3><p class="card-subtitle">Local alert templates ready for backend notification integration.</p><div class="ai-alert-row"><span class="pill info">Entry Price Reached</span><span class="pill warning">Stop Loss Hit</span><span class="pill positive">Target Hit</span><span class="pill info">New Strong Buy</span><span class="pill negative">New Strong Sell</span><span class="pill info">VWAP Cross</span><span class="pill info">MACD Cross</span><span class="pill info">PCR Change</span><span class="pill info">OI Shift</span><span class="pill info">Trend Change</span></div></div><div class="card"><div class="card-header"><div><h3 class="card-title">Trade Journal</h3><p class="card-subtitle">Recent generated signals preserved for review.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Signal</th><th>Entry</th><th>SL</th><th>Time</th><th>Status</th></tr></thead><tbody>${journal || '<tr><td colspan="6">No journal rows yet.</td></tr>'}</tbody></table></div></div></div></div>`;
}

export function renderProTradeX(state) {
  return `${pageHeader('Pro Trade X', 'Advanced terminal: sector strength, option-chain heatmap, risk sizing, alerts, journal, strategy builder and data-health monitoring.', `<div class="toolbar">${dataPill(state.snapshot.status)}<span class="pill info">Pro Suite</span></div>`)}
    ${proSummary(state)}
    <div class="grid cols-2" style="margin-top:14px">${dataHealth(state)}${strategyBuilder(state)}</div>
    <div style="margin-top:14px">${sectorStrength(state)}</div>
    <div style="margin-top:14px">${optionHeatmap(state)}</div>
    <div style="margin-top:14px">${riskCalculator(state)}</div>
    <div style="margin-top:14px">${modePanels(state)}</div>
    <div style="margin-top:14px">${proWatchlist(state)}</div>
    <div style="margin-top:14px">${avoidDetector(state)}</div>
    <div style="margin-top:14px">${alertsAndJournal(state)}</div>
    ${disclaimer()}`;
}
