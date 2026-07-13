import { compact, confidenceBar, dataPill, disclaimer, money, pageHeader, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';
import { directionClass } from '../core/utils.js';

function numberCell(value, cls = '', digits = 0) {
  return `<span class="num ${cls}">${formatNumber(value, digits)}</span>`;
}

function signedCell(value, extraClass = '') {
  const sign = value > 0 ? '+' : '';
  return `<span class="num ${directionClass(value)} ${extraClass}">${sign}${formatNumber(value, 0)}</span>`;
}

function pctCell(value, extraClass = '') {
  const sign = value > 0 ? '+' : '';
  return `<span class="num ${directionClass(value)} ${extraClass}">${sign}${formatNumber(value, 2)}%</span>`;
}

function marketStatusPill(table) {
  if (!table) return '<span class="pill stale">Loading</span>';
  if (table.status === 'MARKET_CLOSED') return '<span class="pill closed">Market Closed</span>';
  if (table.status === 'LIVE') return '<span class="pill live">LIVE · Auto 1s</span>';
  return '<span class="pill delayed">Delayed</span>';
}

function signalCell(signal) {
  const cls = signal === 'BUY' ? 'ref-buy' : signal === 'SELL' ? 'ref-sell' : 'ref-wait';
  return `<span class="ref-signal ${cls}">${signal}</span>`;
}

function nearAtmRows(rows, atmStrike, count = 11) {
  const sorted = [...rows].sort((a, b) => a.strike - b.strike);
  const closestIndex = sorted.reduce((best, row, index) => Math.abs(row.strike - atmStrike) < Math.abs(sorted[best].strike - atmStrike) ? index : best, 0);
  const half = Math.floor(count / 2);
  let start = Math.max(0, closestIndex - half);
  let end = Math.min(sorted.length, start + count);
  start = Math.max(0, end - count);
  return sorted.slice(start, end).map((row) => ({ ...row, isATM: row.strike === atmStrike }));
}

function referenceSideTable(title, side, rows) {
  const isCall = side === 'call';
  const totalOi = rows.reduce((acc, row) => acc + row[side].oi, 0);
  const totalChange = rows.reduce((acc, row) => acc + row[side].changeOI, 0);
  const body = rows.map((row) => {
    const leg = row[side];
    return `<tr>
      <td class="${row.isATM ? 'ref-atm' : ''}">${row.strike}</td>
      <td data-option-side="${side}" data-strike="${row.strike}" data-field="ltp">${formatNumber(leg.ltp, 2)}</td>
      <td data-option-side="${side}" data-strike="${row.strike}" data-field="oi">${formatNumber(leg.oi, 0)}</td>
      <td data-option-side="${side}" data-strike="${row.strike}" data-field="changeOI" class="${leg.changeOI >= 0 ? 'ref-pos' : 'ref-neg'}">${leg.changeOI > 0 ? '+' : ''}${formatNumber(leg.changeOI, 0)}</td>
      <td data-option-side="${side}" data-strike="${row.strike}" data-field="oiPct">${Number.isFinite(leg.oiPct) && leg.oiPct !== 0 ? `${formatNumber(leg.oiPct, 0)} %` : '-'}</td>
    </tr>`;
  }).join('');
  return `<div class="ref-option-card ${isCall ? 'ref-call-card' : 'ref-put-card'}">
    <div class="ref-option-title">${title}</div>
    <div class="ref-table-wrap"><table class="ref-option-table">
      <thead><tr><th>STRIKE</th><th>LAST</th><th>OPEN INT</th><th>CHANGE IN OI</th><th>OI Percentage</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Total :</td><td></td><td>${formatNumber(totalOi / 100000, 2)} (In Lac)</td><td>${formatNumber(totalChange, 0)}</td><td></td></tr></tfoot>
    </table></div>
  </div>`;
}

function referenceDerivativeModel(state, table) {
  const minutes = Number(state.tableTimeframe || 5);
  const rows = nearAtmRows(table.rows, table.atmStrike, 11);
  const buttons = [5, 15].map((m) => `<button class="button ${minutes === m ? 'active' : ''}" data-action="table-timeframe" data-minutes="${m}">${m}Min</button>`).join('');
  return `<div class="card ref-model-card">
    <div class="ref-model-header">
      <div><div class="ref-model-kicker">Derivative Model</div><h3>NIFTY Option Data · Nearest Expiry</h3><p>Reference-style live option table built from current option-chain data. Data values update automatically; screenshot values are not copied.</p></div>
      <div class="toolbar">${buttons}</div>
    </div>
    <div class="ref-model-grid">
      ${referenceSideTable('NIFTY CALL OPTION', 'call', rows)}
      ${referenceSideTable('NIFTY PUT OPTION', 'put', rows)}
    </div>
  </div>`;
}

function referenceIntradayMatrix(state, table) {
  const minutes = Number(state.tableTimeframe || 5);
  const history = aggregateHistory(state.niftyTableHistory?.length ? state.niftyTableHistory : [table.reading], minutes).slice(0, 24);
  const body = history.map((r) => `<tr>
    <td>${new Date(r.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', '')}</td>
    <td>${formatNumber(r.callOI, 0)}</td>
    <td>${formatNumber(r.putOI, 0)}</td>
    <td class="${r.diff >= 0 ? 'ref-pos' : 'ref-neg'}">${r.diff > 0 ? '+' : ''}${formatNumber(r.diff, 0)}</td>
    <td>${formatNumber(r.pcr, 2)}</td>
    <td>${signalCell(r.optionSignal)}</td>
    <td>${formatNumber(r.vwap, 2)}</td>
    <td class="${r.currentPrice >= r.vwap ? 'ref-pos' : 'ref-neg'}">${formatNumber(r.currentPrice, 2)}</td>
    <td>${signalCell(r.vwapSignal)}</td>
  </tr>`).join('');
  return `<div class="card ref-intraday-card">
    <div class="ref-intraday-title">INTRADAY DATA <span>(Use this indicator only after 10:30AM)</span></div>
    <div class="table-wrap"><table class="ref-intraday-table">
      <thead><tr><th>Time</th><th>Call</th><th>Put</th><th>Diff</th><th>PCR</th><th>Option Signal</th><th>VWAP</th><th>Price</th><th>VWAP Signal</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>
  </div>`;
}

function sortRows(rows, side, sortState) {
  const state = sortState || { side, key: 'strike', dir: 'asc' };
  const dir = state.dir === 'desc' ? -1 : 1;
  const key = state.side === side ? state.key : 'strike';
  const getter = (row) => {
    if (key === 'strike') return row.strike;
    const leg = row[side];
    if (key === 'ltp') return leg.ltp;
    if (key === 'oi') return leg.oi;
    if (key === 'changeOI') return leg.changeOI;
    if (key === 'oiPct') return leg.oiPct;
    return row.strike;
  };
  return [...rows].sort((a, b) => (getter(a) - getter(b)) * dir);
}

function optionTable({ title, side, rows, totals, sortState }) {
  const sideUpper = side === 'call' ? 'CALL' : 'PUT';
  const totalOI = side === 'call' ? totals.totalCallOI : totals.totalPutOI;
  const totalChange = side === 'call' ? totals.totalCallChangeOI : totals.totalPutChangeOI;
  const sorted = sortRows(rows, side, sortState);
  const header = (label, key) => `<th class="sortable" data-action="table-sort" data-side="${side}" data-sort="${key}">${label}${sortState?.side === side && sortState?.key === key ? (sortState.dir === 'asc' ? ' ↑' : ' ↓') : ''}</th>`;
  const body = sorted.map((row) => {
    const leg = row[side];
    return `<tr class="${row.isATM ? 'atm-row' : ''}">
      <td class="fixed-col"><b class="num">${row.strike}</b>${row.isATM ? '<br><span class="pill info">ATM</span>' : ''}</td>
      <td><span data-option-side="${side}" data-strike="${row.strike}" data-field="ltp">${money(leg.ltp)}</span> <span class="value-flash ${leg.deltaClass?.ltp || ''}"></span></td>
      <td><span data-option-side="${side}" data-strike="${row.strike}" data-field="oi">${numberCell(leg.oi, leg.deltaClass?.oi || '')}</span></td>
      <td><span data-option-side="${side}" data-strike="${row.strike}" data-field="changeOI">${signedCell(leg.changeOI, leg.deltaClass?.changeOI || '')}</span></td>
      <td><span data-option-side="${side}" data-strike="${row.strike}" data-field="oiPct">${pctCell(leg.oiPct, leg.deltaClass?.oiPct || '')}</span></td>
    </tr>`;
  }).join('');
  return `<div class="card table-terminal-card">
    <div class="card-header"><div><h3 class="card-title">${title}</h3><p class="card-subtitle">${sideUpper} option chain · LTP, OI, OI change and OI percentage update automatically.</p></div></div>
    <div class="option-total-strip">
      <span>Total ${sideUpper} OI <b>${formatNumber(totalOI, 0)}</b></span>
      <span>Total Change in ${sideUpper} OI <b class="${directionClass(totalChange)}">${totalChange > 0 ? '+' : ''}${formatNumber(totalChange, 0)}</b></span>
    </div>
    <div class="table-wrap table-page-wrap"><table class="table-page-table">
      <thead><tr>${header('Strike Price', 'strike')}${header('LTP', 'ltp')}${header('Open Interest', 'oi')}${header('Change in OI', 'changeOI')}${header('OI %', 'oiPct')}</tr></thead>
      <tbody>${body || '<tr><td colspan="5"><div class="empty-state">No strikes match the search.</div></td></tr>'}</tbody>
      <tfoot><tr><td class="fixed-col"><b>Total</b></td><td>—</td><td><span data-table-total="${side === 'call' ? 'totalCallOI' : 'totalPutOI'}">${numberCell(totalOI)}</span></td><td><span data-table-total="${side === 'call' ? 'totalCallChangeOI' : 'totalPutChangeOI'}">${signedCell(totalChange)}</span></td><td>—</td></tr></tfoot>
    </table></div>
  </div>`;
}

function aggregateHistory(history, minutes) {
  const bucketMs = minutes * 60 * 1000;
  const map = new Map();
  for (const row of history || []) {
    const bucket = Math.floor(row.timestamp / bucketMs) * bucketMs;
    const existing = map.get(bucket);
    map.set(bucket, existing ? { ...row, timestamp: Math.max(existing.timestamp, row.timestamp) } : { ...row, timestamp: bucket });
  }
  return [...map.values()].slice(-40).reverse();
}

function scaleSeries(values, width = 420, height = 180) {
  const clean = values.map((v) => Number.isFinite(v) ? v : 0);
  const min = Math.min(...clean, 0);
  const max = Math.max(...clean, 0);
  const range = max - min || 1;
  return clean.map((v, i) => {
    const x = clean.length <= 1 ? width / 2 : (i / (clean.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function trendChartCard(title, subtitle, values, color = '#00d48a') {
  const width = 420;
  const height = 180;
  const zeroY = (() => {
    const clean = values.map((v) => Number.isFinite(v) ? v : 0);
    const min = Math.min(...clean, 0);
    const max = Math.max(...clean, 0);
    const range = max - min || 1;
    return height - ((0 - min) / range) * height;
  })();
  return `<div class="card trend-chart-card">
    <div class="card-header"><div><h3 class="card-title">${title}</h3><p class="card-subtitle">${subtitle}</p></div></div>
    <div class="trend-chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="trend-chart-svg" preserveAspectRatio="none">
        <line x1="0" y1="${zeroY.toFixed(1)}" x2="${width}" y2="${zeroY.toFixed(1)}" stroke="rgba(148,163,184,.35)" stroke-width="1" stroke-dasharray="6 6" />
        <polyline points="${scaleSeries(values, width, height)}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </div>
  </div>`;
}

function trendPanels(state, table) {
  const history = [...(state.niftyTableHistory?.length ? state.niftyTableHistory : [table.reading])].slice(-60);
  const diffValues = history.map((r) => r.diff || 0);
  const priceVwapValues = history.map((r) => (r.currentPrice || 0) - (r.vwap || 0));
  const latest = table.reading;
  const total = Math.max(1, latest.callOI + latest.putOI);
  const callPct = (latest.callOI / total) * 100;
  const putPct = (latest.putOI / total) * 100;
  return `<div class="grid cols-3 table-trend-grid" style="margin-bottom:14px">
    ${trendChartCard('NIFTY Intraday OI Trend', 'Option data difference: Put OI − Call OI with zero line', diffValues, latest.diff >= 0 ? '#00d48a' : '#ff4d5e')}
    ${trendChartCard('NIFTY Price vs VWAP Trend', 'Current price minus VWAP with zero line', priceVwapValues, priceVwapValues.at(-1) >= 0 ? '#5aa7ff' : '#ff4d5e')}
    <div class="card trend-summary-card">
      <div class="card-header"><div><h3 class="card-title">NIFTY Intraday Trend</h3><p class="card-subtitle">Reference-style summary, calculated from live table data.</p></div></div>
      <div class="trend-summary-box">
        <div class="trend-summary-row"><span>Call Share</span><b class="neg">${formatNumber(callPct, 2)}%</b></div>
        <div class="trend-summary-row"><span>Put Share</span><b class="pos">${formatNumber(putPct, 2)}%</b></div>
        <div class="trend-summary-row"><span>PCR</span><b class="${latest.pcr >= 1 ? 'pos' : 'neg'}">${formatNumber(latest.pcr, 2)}</b></div>
        <div class="trend-summary-row"><span>Signal</span>${signalBadge(latest.optionSignal)}</div>
      </div>
    </div>
  </div>`;
}

function pcrRuleSignal(pcr) {
  if (pcr >= 2) return 'STRONG BUY';
  if (pcr > 1) return 'BUY';
  if (pcr < 1) return 'SELL';
  return 'NEUTRAL';
}

function pcrIntradayTable(state, table) {
  const minutes = Number(state.tableTimeframe || 5);
  const history = aggregateHistory(state.niftyTableHistory?.length ? state.niftyTableHistory : [table.reading], minutes);
  const buttons = [5, 15].map((m) => `<button class="button ${minutes === m ? 'active' : ''}" data-action="table-timeframe" data-minutes="${m}">${m} Minutes</button>`).join('');
  const rows = history.map((r, index) => {
    const older = history[index + 1];
    const pcrChange = older ? r.pcr - older.pcr : 0;
    const pcrSignal = pcrRuleSignal(r.pcr);
    return `<tr>
      <td class="num">${new Date(r.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</td>
      <td>${numberCell(r.callOI)}</td>
      <td>${numberCell(r.putOI)}</td>
      <td><span class="num ${r.pcr >= 1 ? 'pos' : 'neg'}">${formatNumber(r.pcr, 2)}</span></td>
      <td><span class="num ${directionClass(pcrChange)}">${pcrChange > 0 ? '+' : ''}${formatNumber(pcrChange, 3)}</span></td>
      <td>${signalBadge(pcrSignal)}</td>
      <td><span class="num ${directionClass(r.diff)}">${r.diff > 0 ? '+' : ''}${formatNumber(r.diff, 0)}</span></td>
      <td>${signalBadge(r.optionSignal)}</td>
      <td>${signalBadge(r.vwapSignal)}</td>
    </tr>`;
  }).join('');
  return `<div class="card reading-table table-pcr-card">
    <div class="card-header"><div><h3 class="card-title">Intraday Put/Call Ratio Table</h3><p class="card-subtitle">PCR = Total Put OI ÷ Total Call OI. Rule column: PCR &lt; 1 = SELL, PCR &gt; 1 = BUY, PCR ≥ 2 = STRONG BUY. Use 5-minute or 15-minute interval selector.</p></div><div class="toolbar">${buttons}</div></div>
    <div style="padding:16px"><div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Call OI</th><th>Put OI</th><th>Put/Call Ratio</th><th>PCR Change</th><th>PCR Signal</th><th>Put − Call Diff</th><th>Confirmed Option Signal</th><th>VWAP Signal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div>`;
}

function signalTable(state, table) {
  const minutes = Number(state.tableTimeframe || 5);
  const history = aggregateHistory(state.niftyTableHistory?.length ? state.niftyTableHistory : [table.reading], minutes);
  const rows = history.map((r) => `<tr>
    <td class="num">${new Date(r.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</td>
    <td>${numberCell(r.callOI)}</td>
    <td>${numberCell(r.putOI)}</td>
    <td><span class="num ${r.pcr >= 1 ? 'pos' : 'neg'}">${formatNumber(r.pcr, 2)}</span></td>
    <td><span class="num ${directionClass(r.diff)}">${r.diff > 0 ? '+' : ''}${formatNumber(r.diff, 0)}</span></td>
    <td>${signalBadge(r.optionSignal)}</td>
    <td>${money(r.vwap)}</td>
    <td>${money(r.currentPrice)}</td>
    <td>${signalBadge(r.vwapSignal)}</td>
  </tr>`).join('');
  const buttons = [5, 10, 15].map((m) => `<button class="button ${minutes === m ? 'active' : ''}" data-action="table-timeframe" data-minutes="${m}">${m} Minutes</button>`).join('');
  return `<div class="card reading-table table-signal-card">
    <div class="card-header"><div><h3 class="card-title">Live Market Signal Table</h3><p class="card-subtitle">Signals combine PCR, OI, Change in OI, price action, VWAP, volume and trend direction. PCR alone never creates a trade signal.</p></div><div class="toolbar">${buttons}</div></div>
    <div style="padding:16px"><div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Call OI</th><th>Put OI</th><th>PCR</th><th>Difference</th><th>Option Signal</th><th>VWAP</th><th>Current Price</th><th>VWAP Signal</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div>`;
}

function loadingSkeleton() {
  return `${pageHeader('Table — NIFTY 50 Options Analysis', 'Loading NIFTY 50 option-chain data from the configured live/free market source…', '')}
    <div class="grid cols-2"><div class="card pad"><div class="loader-ring"></div><p class="muted">Fetching CALL option chain…</p></div><div class="card pad"><div class="loader-ring"></div><p class="muted">Fetching PUT option chain…</p></div></div>`;
}

export function renderTablePage(state) {
  const table = state.niftyTable;
  if (!table?.rows?.length) return loadingSkeleton();
  const query = String(state.tableSearch || '').trim();
  let rows = table.rows.map((row) => ({ ...row, isATM: row.strike === table.atmStrike }));
  if (query) rows = rows.filter((row) => String(row.strike).includes(query));
  const totals = {
    totalCallOI: rows.reduce((acc, row) => acc + row.call.oi, 0),
    totalPutOI: rows.reduce((acc, row) => acc + row.put.oi, 0),
    totalCallChangeOI: rows.reduce((acc, row) => acc + row.call.changeOI, 0),
    totalPutChangeOI: rows.reduce((acc, row) => acc + row.put.changeOI, 0)
  };
  const diff = totals.totalPutOI - totals.totalCallOI;
  const sourceLabel = String(table.source || '').toLowerCase().includes('upstox') ? 'Official Upstox API' : 'Public fallback feed';
  return `${pageHeader('Table — NIFTY 50 Options Analysis', `Institutional-grade NIFTY 50 option-chain table with live CALL/PUT OI, PCR, VWAP and multi-condition signals.`, `<div class="toolbar">${marketStatusPill(table)}<span class="pill info">${table.marketOpen ? 'Auto 1s' : 'Market Closed'}</span><span class="pill ${sourceLabel.includes('Official') ? 'live' : 'warning'}">Source: ${sourceLabel}</span></div>`)}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px">
      <div>${dataPill(table.status === 'MARKET_CLOSED' ? 'DELAYED' : table.status)} <span class="pill info">Spot ${formatNumber(table.spot, 2)}</span><span class="pill info">ATM ${table.atmStrike}</span><span class="pill ${diff >= 0 ? 'positive' : 'negative'}">Diff ${diff > 0 ? '+' : ''}${formatNumber(diff, 0)}</span><span class="pill info">Fetched ${formatDateTime(table.fetchedAt)}</span></div>
      <input class="filter-input" style="width:240px" data-input="table-strike-search" value="${state.tableSearch || ''}" placeholder="Search strike price…" />
    </div>
    ${referenceDerivativeModel(state, table)}
    ${referenceIntradayMatrix(state, table)}
    <div class="grid cols-4" style="margin-bottom:14px">
      <div class="card pad"><div class="metric-label">Total Call OI</div><div class="metric-value num">${formatNumber(totals.totalCallOI, 0)}</div></div>
      <div class="card pad"><div class="metric-label">Total Put OI</div><div class="metric-value num">${formatNumber(totals.totalPutOI, 0)}</div></div>
      <div class="card pad"><div class="metric-label">PCR</div><div class="metric-value num ${totals.totalPutOI / Math.max(1, totals.totalCallOI) >= 1 ? 'pos' : 'neg'}">${formatNumber(totals.totalPutOI / Math.max(1, totals.totalCallOI), 2)}</div></div>
      <div class="card pad"><div class="metric-label">Market Status</div><div class="metric-value">${table.status === 'MARKET_CLOSED' ? 'Market Closed' : table.status}</div></div>
    </div>
    ${trendPanels(state, table)}
    <div class="table-page-layout">
      ${optionTable({ title: 'Call Option Table', side: 'call', rows, totals, sortState: state.tableSort })}
      ${optionTable({ title: 'Put Option Table', side: 'put', rows, totals, sortState: state.tableSort })}
    </div>
    ${pcrIntradayTable(state, table)}
    ${signalTable(state, table)}
    <div class="footer-note">Accuracy note: this page parses the public Groww NIFTY option-chain payload when available and updates every second. For exchange-certified OI, use an official NSE/broker market-data API. ${disclaimer()}</div>`;
}
