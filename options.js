import { STOCK_UNIVERSE, PE_RATIOS } from '../data/universe.js';
import { compact, confidenceBar, dataPill, disclaimer, money, number, pageHeader, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';
import { directionClass } from '../core/utils.js';

function optionMetricCards(options) {
  const t = options.totals;
  const h = options.highlights;
  return `<div class="grid cols-4">
    <div class="card metric-card"><div class="metric-label">Put/Call Ratio (PCR)</div><div class="metric-value num">${formatNumber(t.pcr, 2)}</div><div class="metric-meta"><span>Total Put OI ÷ Total Call OI</span><span>${t.pcrZone}</span><span>${t.pcrTrend}</span><span>MA ${formatNumber(t.pcrMA, 2)}</span></div></div>
    <div class="card metric-card"><div class="metric-label">OI PCR / Volume PCR</div><div class="metric-value num">${formatNumber(t.volumePCR, 2)}</div><div class="metric-meta"><span>OI PCR ${formatNumber(t.pcr, 2)}</span><span>Change-in-OI PCR ${formatNumber(t.chgOIPCR, 2)}</span><span class="${directionClass(t.pcrChange)}">Δ ${formatNumber(t.pcrChange, 3)}</span></div></div>
    <div class="card metric-card"><div class="metric-label">Spot vs VWAP</div><div class="metric-value num">${formatNumber(t.spot, 2)}</div><div class="metric-meta"><span>VWAP ${formatNumber(t.vwap, 2)}</span><span class="${directionClass(t.priceVsVwap)}">${formatNumber(t.priceVsVwap, 2)}%</span><span>Slope ${formatNumber(t.vwapSlope, 3)}</span></div></div>
    <div class="card metric-card"><div class="metric-label">Key OI Levels</div><div class="metric-value num">${h.majorSupport} / ${h.majorResistance}</div><div class="metric-meta"><span>Support Put OI</span><span>Resistance Call OI</span><span>ATM ${h.atm}</span></div></div>
  </div>`;
}

function sideTable(options, side) {
  const isCall = side === 'call';
  const title = isCall ? 'CALL OPTION TABLE' : 'PUT OPTION TABLE';
  const colorClass = isCall ? 'cell-highlight-call' : 'cell-highlight-put';
  const rows = options.chain.rows.map((r) => {
    const opt = r[side];
    const tags = [];
    if (r.isATM) tags.push('<span class="pill info">ATM</span>');
    if (isCall && r.strike === options.highlights.highestCallOI) tags.push('<span class="pill negative">Highest Call OI</span>');
    if (!isCall && r.strike === options.highlights.highestPutOI) tags.push('<span class="pill positive">Highest Put OI</span>');
    if (isCall && r.strike === options.highlights.maxCallWriting) tags.push('<span class="pill negative">Max Call Writing</span>');
    if (!isCall && r.strike === options.highlights.maxPutWriting) tags.push('<span class="pill positive">Max Put Writing</span>');
    const highlighted = tags.length ? colorClass : '';
    return `<tr class="${r.isATM ? 'atm-row' : ''}">
      <td><span class="num ${highlighted}">${r.strike}</span></td>
      <td>${money(opt.ltp)}</td>
      <td>${compact(opt.oi)}</td>
      <td><span class="num ${directionClass(opt.changeOI)}">${opt.changeOI > 0 ? '+' : ''}${formatNumber(opt.changeOI, 0)}</span></td>
      <td><span class="num ${directionClass(opt.oiPctChange)}">${opt.oiPctChange > 0 ? '+' : ''}${formatNumber(opt.oiPctChange, 2)}%</span></td>
      <td>${compact(opt.volume)}</td>
      <td><span class="num">${formatNumber(opt.iv, 2)}%</span></td>
      <td>${tags.join(' ') || '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="card-header"><div><h3 class="card-title">${title}</h3><p class="card-subtitle">Highlights include ATM, highest OI and strongest writing zones.</p></div></div>
    <div style="padding:16px"><div class="table-wrap"><table>
      <thead><tr><th>Strike</th><th>LTP</th><th>Open Interest</th><th>Change in OI</th><th>OI % Chg</th><th>Volume</th><th>IV</th><th>Level Tag</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div>`;
}

function readingsTable(history) {
  const rows = history.slice(-28).reverse().map((r) => `<tr>
    <td class="num">${r.time}</td><td>${compact(r.totalCallOI)}</td><td>${compact(r.totalPutOI)}</td><td><span class="num ${directionClass(r.diff)}">${formatNumber(r.diff, 0)}</span></td>
    <td class="num">${formatNumber(r.pcr, 2)}</td><td><span class="num ${directionClass(r.pcrChange)}">${formatNumber(r.pcrChange, 3)}</span></td><td>${r.pcrTrend}</td><td>${signalBadge(r.optionSignal)}</td>
    <td>${money(r.vwap)}</td><td>${money(r.spotPrice)}</td><td><span class="num ${directionClass(r.priceVsVwap)}">${formatNumber(r.priceVsVwap, 2)}%</span></td><td>${signalBadge(r.vwapSignal)}</td>
    <td>${signalBadge(r.combinedSignal)}</td><td>${confidenceBar(r.confidence, r.combinedSignal.includes('SELL'))}</td><td style="white-space:normal;min-width:360px">${r.explanation}</td>
  </tr>`).join('');
  return `<div class="card reading-table">
    <div class="card-header"><div><h3 class="card-title">PCR + VWAP Combined Signal Readings</h3><p class="card-subtitle">Stores readings at intraday intervals. In conflict, the engine shows WAIT FOR CONFIRMATION instead of forcing BUY/SELL.</p></div></div>
    <div style="padding:16px"><div class="table-wrap"><table>
      <thead><tr><th>Time</th><th>Total Call OI</th><th>Total Put OI</th><th>Difference</th><th>PCR</th><th>PCR Change</th><th>PCR Trend</th><th>Option Signal</th><th>VWAP</th><th>Spot Price</th><th>Price vs VWAP</th><th>VWAP Signal</th><th>Combined Signal</th><th>Confidence</th><th>Explanation</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="15"><div class="empty-state">Waiting for readings…</div></td></tr>'}</tbody>
    </table></div></div>
  </div>`;
}

function stockOptionControls(state) {
  const niftyStocks = STOCK_UNIVERSE.filter((s) => s.indices.includes('NIFTY50'));
  const selected = String(state.optionsInstrument || 'NIFTY');
  const selectedStock = selected.startsWith('STOCK:') ? selected.split(':')[1] : '';
  const options = niftyStocks.map((s) => `<option value="STOCK:${s.symbol}" ${selectedStock === s.symbol ? 'selected' : ''}>${s.symbol} — ${s.name}</option>`).join('');
  return `<div class="toolbar" style="gap:8px">
    <span class="pill info">Stock Options</span>
    <select class="select" style="min-width:280px" data-input="stock-option-select">
      <option value="NIFTY" ${selected === 'NIFTY' ? 'selected' : ''}>Index: NIFTY 50</option>
      <option value="BANKNIFTY" ${selected === 'BANKNIFTY' ? 'selected' : ''}>Index: BANK NIFTY</option>
      ${options}
    </select>
  </div>`;
}

function optionAvailabilityPanel(state) {
  const selected = String(state.optionsInstrument || 'NIFTY');
  const niftyStocks = STOCK_UNIVERSE.filter((s) => s.indices.includes('NIFTY50'));
  const rows = niftyStocks.map((stock) => {
    const quote = state.snapshot.stocks.find((s) => s.symbol === stock.symbol);
    const pe = Number.isFinite(PE_RATIOS[stock.symbol]) ? formatNumber(PE_RATIOS[stock.symbol], 2) : 'N/A';
    const active = selected === `STOCK:${stock.symbol}`;
    return `<tr class="row-click ${active ? 'atm-row' : ''}" data-action="select-stock-option" data-instrument="STOCK:${stock.symbol}">
      <td><b>${stock.symbol}</b><br><span class="muted small">${stock.name}</span></td>
      <td>${quote ? money(quote.ltp) : '<span class="muted">—</span>'}</td>
      <td><span class="num">${pe}</span></td>
      <td>${stock.sector}</td>
      <td><span class="pill info">CE</span> <span class="pill warning">PE</span></td>
      <td><span class="num">${quote ? formatNumber(quote.relVolume, 2) : '—'}x</span></td>
      <td><button class="button ${active ? 'active' : ''}" data-action="select-stock-option" data-instrument="STOCK:${stock.symbol}">${active ? 'Selected' : 'Analyze Options'}</button></td>
    </tr>`;
  }).join('');
  return `<div class="card">
    <div class="card-header"><div><h3 class="card-title">NIFTY 50 Stock Options Universe</h3><p class="card-subtitle">All NIFTY 50 stock underlyings available for stock-option analysis. P/E Ratio is shown separately for each stock; CE/PE chains are generated for the selected underlying.</p></div></div>
    <div style="padding:16px"><div class="table-wrap"><table>
      <thead><tr><th>Stock</th><th>LTP</th><th>P/E Ratio</th><th>Sector</th><th>Available Option Types</th><th>Rel Vol</th><th>Action</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div></div>
  </div>`;
}

function optionPageNav(active = 'overview') {
  return `<div class="tabs" style="margin-bottom:14px">
    <button class="tab ${active === 'overview' ? 'active' : ''}" data-action="route" data-route="options">Overview & Stock Options</button>
    <button class="tab ${active === 'chain' ? 'active' : ''}" data-action="route" data-route="options-chain">Option Chain & Signal History</button>
    <button class="tab" data-action="route" data-route="options-ai">Options AI Strategies</button>
  </div>`;
}

function instrumentToolbar(state) {
  const instrumentButtons = ['NIFTY', 'BANKNIFTY'].map((id) => `<button class="button ${state.optionsInstrument === id ? 'active' : ''}" data-action="options-instrument" data-instrument="${id}">${id === 'BANKNIFTY' ? 'BANK NIFTY' : 'NIFTY'}</button>`).join('');
  return `<div class="toolbar">${instrumentButtons}${stockOptionControls(state)}</div>`;
}

export function renderOptions(state) {
  const options = state.options;
  if (!options) return '<div class="empty-state">Options engine is waiting for market snapshot.</div>';
  return `${pageHeader('Options Intelligence', `Overview page for PCR, OI positioning, VWAP context and NIFTY 50 stock-option universe. Heavy option-chain tables were moved to a separate page to keep this page fast and clean.`, instrumentToolbar(state))}
    ${optionPageNav('overview')}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px">
      <div>${dataPill(state.snapshot.status)} <span class="pill info">Underlying ${options.config.label}</span> <span class="pill warning">Overview</span></div>
      <div><span class="pill info">Last update ${formatDateTime(state.snapshot.timestamp)}</span></div>
    </div>
    <div class="option-layout">
      ${optionMetricCards(options)}
      <div class="card pad">
        <div class="trade-head"><div><h3 class="card-title">Combined Engine Output</h3><p class="card-subtitle">PCR is interpreted with context: direction, speed of change, price vs VWAP, writing/unwinding and market trend.</p></div><div>${signalBadge(options.signal.combinedSignal)} ${confidenceBar(options.signal.confidence, options.signal.combinedSignal.includes('SELL'))}</div></div>
        <ul class="explain-list">
          ${options.interpretation.notes.map((n) => `<li class="${n.includes('Conflict') || n.includes('risk') ? 'warn' : 'good'}">${n}</li>`).join('')}
          <li class="info">PCR formula check: Total Put OI ${compact(options.totals.totalPutOI)} ÷ Total Call OI ${compact(options.totals.totalCallOI)} = ${formatNumber(options.totals.pcr, 2)}.</li>
          <li>${options.signal.explanation}</li>
        </ul>
      </div>
      <div class="grid cols-2">
        <div class="card pad"><h3 class="card-title">Page split for speed</h3><p class="card-subtitle">The long call/put chain tables and intraday readings now live on a second page.</p><button class="button primary" data-action="route" data-route="options-chain">Open Option Chain & Signal History</button></div>
        <div class="card pad"><h3 class="card-title">Data quality note</h3><p class="card-subtitle">Index and stock option analytics use the selected underlying. Official live reliability requires the Render + Upstox backend.</p><span class="pill info">Auto-refresh supported</span></div>
      </div>
      ${optionAvailabilityPanel(state)}
    </div>
    ${disclaimer()}`;
}

export function renderOptionsChain(state) {
  const options = state.options;
  if (!options) return '<div class="empty-state">Options chain is waiting for market snapshot.</div>';
  return `${pageHeader('Option Chain & Signal History', `Dedicated page for CALL/PUT option tables, strike-level OI analysis and PCR + VWAP intraday signal history.`, instrumentToolbar(state))}
    ${optionPageNav('chain')}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px">
      <div>${dataPill(state.snapshot.status)} <span class="pill info">Underlying ${options.config.label}</span> <span class="pill warning">Chain Tables</span></div>
      <div><span class="pill info">Last update ${formatDateTime(state.snapshot.timestamp)}</span></div>
    </div>
    <div class="option-layout">
      ${optionMetricCards(options)}
      <div class="card pad">
        <div class="trade-head"><div><h3 class="card-title">Chain Context</h3><p class="card-subtitle">Use this page for detailed call/put OI, change-in-OI, volume, IV, support/resistance and intraday signal tracking.</p></div><div>${signalBadge(options.signal.combinedSignal)} ${confidenceBar(options.signal.confidence, options.signal.combinedSignal.includes('SELL'))}</div></div>
        <ul class="explain-list">
          <li class="info">PCR: ${formatNumber(options.totals.pcr, 2)} · Volume PCR: ${formatNumber(options.totals.volumePCR, 2)} · Change-in-OI PCR: ${formatNumber(options.totals.chgOIPCR, 2)}</li>
          <li>${options.signal.explanation}</li>
        </ul>
      </div>
      <div class="option-tables">${sideTable(options, 'call')}${sideTable(options, 'put')}</div>
      ${readingsTable(state.optionsHistory[state.optionsInstrument] || [])}
    </div>
    ${disclaimer()}`;
}
