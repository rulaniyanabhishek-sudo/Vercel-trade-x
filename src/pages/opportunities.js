import { confidenceBar, dataPill, disclaimer, money, pageHeader, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';

function tradeCard(a, watchlist = new Set()) {
  const watched = watchlist.has(a.symbol);
  const rp = a.riskPlan;
  const entry = rp.entryLow && rp.entryHigh ? `${money(rp.entryLow)} to ${money(rp.entryHigh)}` : '—';
  const supports = a.evidence.slice(0, 4).map((e) => `<li class="good">${e}</li>`).join('');
  const conflicts = [...a.conflicts.slice(0, 2), ...a.warnings.slice(0, 2)].map((e) => `<li class="${e.includes('warning') || e.includes('risk') || e.includes('below') ? 'warn' : 'bad'}">${e}</li>`).join('') || '<li class="warn">No major conflict, but all market analysis remains probabilistic.</li>';
  return `<div class="card trade-card ${watched ? 'pinned-row' : ''}">
    <div class="trade-head"><div><h3 class="card-title">${watched ? '★ ' : ''}${a.symbol}</h3><p class="card-subtitle">${a.name}</p></div><div>${signalBadge(a.signal)}</div></div>
    <div class="toolbar"><span>${confidenceBar(a.confidence, a.signal.includes('SELL'))}</span><span class="pill ${a.riskLevel === 'High' ? 'warning' : 'info'}">${a.riskLevel} risk</span><span class="pill info">${a.timeframe}</span></div>
    <div class="trade-metrics">
      <div class="trade-metric"><span>Current</span><b>${money(a.quote.ltp)}</b></div>
      <div class="trade-metric"><span>Trend</span><b>${a.trend}</b></div>
      <div class="trade-metric"><span>Entry zone</span><b>${entry}</b></div>
      <div class="trade-metric"><span>Stop loss</span><b>${rp.standardStop ? money(rp.standardStop) : '—'}</b></div>
      <div class="trade-metric"><span>Target 1</span><b>${rp.target1 ? money(rp.target1) : '—'}</b></div>
      <div class="trade-metric"><span>Target 2</span><b>${rp.target2 ? money(rp.target2) : '—'}</b></div>
      <div class="trade-metric"><span>Target 3</span><b>${rp.target3 ? money(rp.target3) : '—'}</b></div>
      <div class="trade-metric"><span>Risk/Reward</span><b>${formatNumber(rp.rr, 2)}:1</b></div>
      <div class="trade-metric"><span>Invalidation</span><b>${rp.invalidation ? money(rp.invalidation) : '—'}</b></div>
      <div class="trade-metric"><span>Holding</span><b>Intraday / swing confirmation</b></div>
    </div>
    <div><b>Bullish/Bearish Evidence</b><ul class="explain-list">${supports}</ul></div>
    <div><b>Risk / Conflicting Evidence</b><ul class="explain-list">${conflicts}</ul></div>
    <div class="muted small">Last updated ${formatDateTime(a.timestamp)}</div>
  </div>`;
}

function section(title, rows, emptyText, watchlist = new Set()) {
  return `<div class="card" style="margin-bottom:14px"><div class="card-header"><div><h3 class="card-title">${title}</h3><p class="card-subtitle">${rows.length} candidates · starred candidates are pinned first and never hidden by section limits</p></div></div><div style="padding:16px">${rows.length ? `<div class="opportunity-grid">${rows.map((row) => tradeCard(row, watchlist)).join('')}</div>` : `<div class="empty-state">${emptyText}</div>`}</div></div>`;
}

function pinAndLimit(rows, watchlist = new Set(), limit = 8) {
  const order = [...watchlist];
  const pinned = rows.filter((row) => watchlist.has(row.symbol)).sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
  const rest = rows.filter((row) => !watchlist.has(row.symbol));
  const remaining = Math.max(0, limit - pinned.length);
  return [...pinned, ...rest.slice(0, remaining)];
}

export function renderOpportunities(state) {
  const watchlist = state.watchlist || new Set();
  const strongBuy = pinAndLimit(state.analyses.filter((a) => a.signal === 'STRONG BUY').sort((a, b) => b.confidence - a.confidence), watchlist, 8);
  const buy = pinAndLimit(state.analyses.filter((a) => a.signal === 'BUY').sort((a, b) => b.confidence - a.confidence), watchlist, 8);
  const strongSell = pinAndLimit(state.analyses.filter((a) => a.signal === 'STRONG SELL').sort((a, b) => b.confidence - a.confidence), watchlist, 8);
  const sell = pinAndLimit(state.analyses.filter((a) => a.signal === 'SELL').sort((a, b) => b.confidence - a.confidence), watchlist, 8);
  const wait = pinAndLimit(state.analyses.filter((a) => ['WAIT', 'WEAK BUY', 'WEAK SELL'].includes(a.signal)).sort((a, b) => b.confidence - a.confidence), watchlist, 8);
  const avoid = pinAndLimit(state.analyses.filter((a) => a.signal === 'NO TRADE' || a.riskPlan.rr < 1.5 || a.warnings.length).sort((a, b) => b.warnings.length - a.warnings.length), watchlist, 8);
  return `${pageHeader('Trade Opportunities', `Fewer, higher-quality, explainable candidates. Trades with poor risk/reward, stale data, weak volume, overextension or conflicts are rejected or moved to WAIT/AVOID.`, '')}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px"><div>${dataPill(state.snapshot.status)} <span class="pill warning">Minimum R/R 1:1.5</span> <span class="pill info">Regime ${state.marketRegime.summary}</span></div></div>
    ${section('Strong Buy', strongBuy, 'No Strong Buy signals passed quality control right now.', watchlist)}
    ${section('Buy', buy, 'No Buy signals currently meet the required evidence/risk standard.', watchlist)}
    ${section('Strong Sell', strongSell, 'No Strong Sell signals passed quality control right now.', watchlist)}
    ${section('Sell', sell, 'No Sell signals currently meet the required evidence/risk standard.', watchlist)}
    ${section('Wait', wait, 'No waitlisted weak signals right now.', watchlist)}
    ${section('Avoid / No Trade', avoid, 'No avoid candidates triggered by risk controls right now.', watchlist)}
    ${disclaimer()}`;
}
