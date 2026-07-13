import { TIMEFRAMES } from '../data/universe.js';
import { analyzeStock } from '../engines/signalEngine.js';
import { confidenceBar, dataPill, disclaimer, money, pageHeader, qualityChips, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';
import { indicatorValueText } from '../engines/indicators.js';

function indicatorTable(analysis) {
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Full Indicator Consensus</h3><p class="card-subtitle">Weighted multi-indicator engine. High confidence requires independent agreement.</p></div></div><div style="padding:16px"><div class="table-wrap"><table>
    <thead><tr><th>Indicator</th><th>Value</th><th>Signal</th><th>Weight</th><th>Explanation</th></tr></thead>
    <tbody>${analysis.items.map((i) => `<tr><td><b>${i.name}</b></td><td class="num">${typeof i.value === 'number' ? indicatorValueText(i.name, i.value) : i.value}</td><td>${signalBadge(i.signal)}</td><td class="num">${formatNumber(i.weight, 1)}%</td><td style="white-space:normal;min-width:300px">${i.explanation}</td></tr>`).join('')}</tbody>
  </table></div></div></div>`;
}

function supportResistance(analysis) {
  const supportRows = analysis.indicators.supports.slice(0, 5).map((s) => `<tr><td>${money(s.price)}</td><td>${s.strength} Support</td><td>${s.touches}</td><td>${s.source}</td></tr>`).join('');
  const resistanceRows = analysis.indicators.resistances.slice(0, 5).map((r) => `<tr><td>${money(r.price)}</td><td>${r.strength} Resistance</td><td>${r.touches}</td><td>${r.source}</td></tr>`).join('');
  return `<div class="grid cols-2">
    <div class="card"><div class="card-header"><div><h3 class="card-title">Support Levels</h3><p class="card-subtitle">Swing lows, pivot zones and high-touch areas.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Level</th><th>Class</th><th>Touches</th><th>Source</th></tr></thead><tbody>${supportRows || '<tr><td colspan="4">No clean support level detected.</td></tr>'}</tbody></table></div></div></div>
    <div class="card"><div class="card-header"><div><h3 class="card-title">Resistance Levels</h3><p class="card-subtitle">Swing highs, pivot zones and supply references.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Level</th><th>Class</th><th>Touches</th><th>Source</th></tr></thead><tbody>${resistanceRows || '<tr><td colspan="4">No clean resistance level detected.</td></tr>'}</tbody></table></div></div></div>
  </div>`;
}

function riskTable(analysis) {
  const r = analysis.riskPlan;
  return `<div class="card"><div class="card-header"><div><h3 class="card-title">Entry, Stop-Loss & Targets</h3><p class="card-subtitle">Calculated from ATR, support/resistance, VWAP, Supertrend and pivot structure—not arbitrary percentages.</p></div></div><div style="padding:16px"><div class="table-wrap"><table>
    <thead><tr><th>Entry Zone</th><th>Conservative Stop</th><th>Standard Stop</th><th>Aggressive Stop</th><th>Target 1</th><th>Target 2</th><th>Target 3</th><th>Risk/Reward</th><th>Invalidation</th></tr></thead>
    <tbody><tr><td>${r.entryLow ? `${money(r.entryLow)} to ${money(r.entryHigh)}` : '—'}</td><td>${r.conservativeStop ? money(r.conservativeStop) : '—'}</td><td>${r.standardStop ? money(r.standardStop) : '—'}</td><td>${r.aggressiveStop ? money(r.aggressiveStop) : '—'}</td><td>${r.target1 ? money(r.target1) : '—'}</td><td>${r.target2 ? money(r.target2) : '—'}</td><td>${r.target3 ? money(r.target3) : '—'}</td><td><span class="num">${formatNumber(r.rr, 2)}:1</span></td><td>${r.invalidation ? money(r.invalidation) : '—'}</td></tr></tbody>
  </table></div><ul class="explain-list">${r.notes.map((n) => `<li class="warn">${n}</li>`).join('')}</ul></div></div>`;
}

function buySellZones(analysis, timeframe) {
  const r = analysis.riskPlan || {};
  const price = analysis.quote.ltp;
  const atr = analysis.indicators.atr || price * 0.01;
  const scoreSide = analysis.signal.includes('SELL') ? -1 : analysis.signal.includes('BUY') ? 1 : analysis.score >= 0 ? 1 : -1;
  const isBuy = scoreSide >= 0;
  const sideLabel = isBuy ? 'Buy' : 'Sell';
  const entryLow = Number.isFinite(r.entryLow) ? r.entryLow : isBuy ? price - atr * 0.25 : price - atr * 0.15;
  const entryHigh = Number.isFinite(r.entryHigh) ? r.entryHigh : isBuy ? price + atr * 0.15 : price + atr * 0.25;
  const ideal = (entryLow + entryHigh) / 2;
  const aggressive = isBuy ? entryHigh : entryLow;
  const conservative = isBuy ? entryLow : entryHigh;
  const stop = Number.isFinite(r.standardStop) ? r.standardStop : isBuy ? price - atr * 1.2 : price + atr * 1.2;
  const target1 = Number.isFinite(r.target1) ? r.target1 : isBuy ? price + atr * 1.4 : price - atr * 1.4;
  const target2 = Number.isFinite(r.target2) ? r.target2 : isBuy ? price + atr * 2.1 : price - atr * 2.1;
  const target3 = Number.isFinite(r.target3) ? r.target3 : isBuy ? price + atr * 3.0 : price - atr * 3.0;
  const risk = Math.abs(ideal - stop);
  const reward1 = Math.abs(target1 - ideal);
  const reward2 = Math.abs(target2 - ideal);
  const reward3 = Math.abs(target3 - ideal);
  const riskPct = ideal ? (risk / ideal) * 100 : 0;
  const reward1Pct = ideal ? (reward1 / ideal) * 100 : 0;
  const reward2Pct = ideal ? (reward2 / ideal) * 100 : 0;
  const reward3Pct = ideal ? (reward3 / ideal) * 100 : 0;
  const rr = risk ? reward1 / risk : 0;
  const status = ['WAIT', 'NO TRADE', 'NEUTRAL'].includes(analysis.signal) ? 'WAIT FOR CONFIRMATION' : 'ACTIVE ZONE';
  return `<div class="card zone-card">
    <div class="card-header"><div><h3 class="card-title">🎯 ${sideLabel}/Sell Zones</h3><p class="card-subtitle">Optimal entry and exit levels for ${analysis.symbol} (${money(price)}) · Timeframe ${timeframe}. Recalculated from live price, ATR, VWAP, support/resistance and volatility.</p></div><div>${signalBadge(status)}</div></div>
    <div class="zone-grid zone-entry-grid">
      <div class="zone-tile aggressive"><span>⚡ Aggressive ${sideLabel} Entry</span><b>${money(aggressive)}</b></div>
      <div class="zone-tile ideal"><span>🎯 Ideal ${sideLabel} Entry</span><b>${money(ideal)}</b></div>
      <div class="zone-tile conservative"><span>🛡 Conservative ${sideLabel} Entry</span><b>${money(conservative)}</b></div>
    </div>
    <div class="zone-grid zone-target-grid">
      <div class="zone-tile stop"><span>Stop Loss</span><b>${money(stop)}</b></div>
      <div class="zone-tile target"><span>Target 1</span><b>${money(target1)}</b></div>
      <div class="zone-tile target"><span>Target 2</span><b>${money(target2)}</b></div>
      <div class="zone-tile target"><span>Target 3</span><b>${money(target3)}</b></div>
    </div>
    <div class="zone-summary">
      <div><span>Risk</span><b class="neg">${money(risk)} (${formatNumber(riskPct, 2)}%)</b></div>
      <div><span>Reward (T1)</span><b class="pos">${money(reward1)} (${formatNumber(reward1Pct, 2)}%)</b></div>
      <div><span>Risk:Reward</span><b>1:${formatNumber(rr, 2)}</b></div>
      <div><span>Expected Return</span><b class="pos">${formatNumber(reward2Pct, 2)}% – ${formatNumber(reward3Pct, 2)}%</b></div>
    </div>
  </div>`;
}

function cci(candles, period = 20) {
  if (!candles?.length || candles.length < period) return 0;
  const slice = candles.slice(-period);
  const tp = slice.map((c) => (c.high + c.low + c.close) / 3);
  const mean = tp.reduce((a, b) => a + b, 0) / tp.length;
  const md = tp.reduce((a, v) => a + Math.abs(v - mean), 0) / tp.length || 1;
  return ((tp[tp.length - 1] - mean) / (0.015 * md));
}

function mfi(candles, period = 14) {
  if (!candles?.length || candles.length < period + 1) return 50;
  const slice = candles.slice(-period - 1);
  let pos = 0; let neg = 0;
  for (let i = 1; i < slice.length; i += 1) {
    const tp = (slice[i].high + slice[i].low + slice[i].close) / 3;
    const prevTp = (slice[i - 1].high + slice[i - 1].low + slice[i - 1].close) / 3;
    const flow = tp * slice[i].volume;
    if (tp >= prevTp) pos += flow; else neg += flow;
  }
  return neg ? 100 - (100 / (1 + pos / neg)) : 100;
}

function cmf(candles, period = 20) {
  if (!candles?.length || candles.length < period) return 0;
  const slice = candles.slice(-period);
  let mfv = 0; let vol = 0;
  for (const c of slice) {
    const mfm = c.high === c.low ? 0 : ((c.close - c.low) - (c.high - c.close)) / (c.high - c.low);
    mfv += mfm * c.volume; vol += c.volume;
  }
  return vol ? mfv / vol : 0;
}

function obvTrend(candles) {
  if (!candles?.length || candles.length < 20) return 'Flat';
  let obv = 0;
  const arr = candles.slice(-20).map((c, i, a) => {
    if (i > 0) obv += c.close >= a[i - 1].close ? c.volume : -c.volume;
    return obv;
  });
  return arr[arr.length - 1] > arr[0] ? 'Increasing' : arr[arr.length - 1] < arr[0] ? 'Decreasing' : 'Flat';
}

function williamsR(candles, period = 14) {
  if (!candles?.length || candles.length < period) return -50;
  const slice = candles.slice(-period);
  const high = Math.max(...slice.map((c) => c.high));
  const low = Math.min(...slice.map((c) => c.low));
  const close = slice[slice.length - 1].close;
  return high === low ? -50 : ((high - close) / (high - low)) * -100;
}

function roc(candles, period = 12) {
  if (!candles?.length || candles.length <= period) return 0;
  const now = candles[candles.length - 1].close;
  const old = candles[candles.length - 1 - period].close;
  return old ? ((now - old) / old) * 100 : 0;
}

function techSignal(value, buyCond, sellCond) {
  return buyCond ? 'BUY' : sellCond ? 'SELL' : 'NEUTRAL';
}

function technicalMatrix(analysis, candles) {
  const q = analysis.quote;
  const i = analysis.indicators;
  const cciVal = cci(candles);
  const mfiVal = mfi(candles);
  const cmfVal = cmf(candles);
  const wr = williamsR(candles);
  const rocVal = roc(candles);
  const obv = obvTrend(candles);
  const cloudTop = Math.max(i.ichimokuSpanA || q.ltp, i.ichimokuSpanB || q.ltp);
  const cloudBottom = Math.min(i.ichimokuSpanA || q.ltp, i.ichimokuSpanB || q.ltp);
  const fibMid = i.supports?.[0] && i.resistances?.[0] ? (i.supports[0].price + i.resistances[0].price) / 2 : q.ltp;
  const list = [
    ['RSI', formatNumber(i.rsi, 1), techSignal(i.rsi, i.rsi >= 52 && i.rsi <= 72 && i.rsiSlope >= -0.2, i.rsi <= 48 && i.rsi >= 25 && i.rsiSlope <= 0.2)],
    ['MACD', i.macdHist >= 0 ? 'Bullish' : 'Bearish', techSignal(i.macdHist, i.macd > i.macdSignal && i.macdHist >= 0, i.macd < i.macdSignal && i.macdHist <= 0)],
    ['VWAP', q.ltp >= i.vwap ? 'Above' : 'Below', techSignal(i.vwap, q.ltp > i.vwap && i.vwapSlope >= -0.02, q.ltp < i.vwap && i.vwapSlope <= 0.02)],
    ['EMA 20', q.ltp >= i.ema20 ? 'Above' : 'Below', techSignal(i.ema20, q.ltp > i.ema20, q.ltp < i.ema20)],
    ['EMA 50', q.ltp >= i.ema50 ? 'Above' : 'Below', techSignal(i.ema50, q.ltp > i.ema50, q.ltp < i.ema50)],
    ['SMA 200', q.ltp >= (i.sma200 || i.sma50) ? 'Above' : 'Below', techSignal(i.sma50, q.ltp > i.sma50, q.ltp < i.sma50)],
    ['ADX', formatNumber(i.adx, 1), techSignal(i.adx, i.adx >= 20 && i.plusDI > i.minusDI, i.adx >= 20 && i.minusDI > i.plusDI)],
    ['ATR', money(i.atr), 'NEUTRAL'],
    ['OBV', obv, techSignal(obv, obv === 'Increasing', obv === 'Decreasing')],
    ['CMF', formatNumber(cmfVal, 3), techSignal(cmfVal, cmfVal > 0, cmfVal < 0)],
    ['MFI', formatNumber(mfiVal, 1), techSignal(mfiVal, mfiVal >= 52 && mfiVal < 85, mfiVal <= 48 && mfiVal > 15)],
    ['Bollinger', i.bbWidth < 1.2 ? 'Squeeze' : q.ltp > i.bbBasis ? 'Upper Expansion' : 'Lower Expansion', techSignal(i.bbWidth, q.ltp > i.bbBasis && i.bbWidth >= 0.6, q.ltp < i.bbBasis && i.bbWidth >= 0.6)],
    ['Ichimoku', q.ltp > cloudTop ? 'Above Cloud' : q.ltp < cloudBottom ? 'Below Cloud' : 'Inside Cloud', techSignal(q.ltp, q.ltp > cloudTop && i.ichimokuConversion >= i.ichimokuBase, q.ltp < cloudBottom && i.ichimokuConversion <= i.ichimokuBase)],
    ['Supertrend', i.supertrendDirection, i.supertrendDirection === 'BULLISH' ? 'BUY' : i.supertrendDirection === 'BEARISH' ? 'SELL' : 'NEUTRAL'],
    ['CCI', formatNumber(cciVal, 1), techSignal(cciVal, cciVal > 50, cciVal < -50)],
    ['Stochastic', formatNumber(i.stochK, 1), techSignal(i.stochK, i.stochK > i.stochD && i.stochK < 85, i.stochK < i.stochD && i.stochK > 15)],
    ['Williams %R', formatNumber(wr, 1), techSignal(wr, wr > -50, wr < -50)],
    ['ROC', `${formatNumber(rocVal, 2)}%`, techSignal(rocVal, rocVal > 0, rocVal < 0)],
    ['Pivot Points', q.ltp > i.pivots.pivot ? 'Above Pivot' : 'Below Pivot', techSignal(q.ltp, q.ltp > i.pivots.pivot, q.ltp < i.pivots.pivot)],
    ['Fibonacci', q.ltp > fibMid ? 'Above Mid-Zone' : 'Below Mid-Zone', techSignal(q.ltp, q.ltp > fibMid, q.ltp < fibMid)]
  ].map(([name, value, signal]) => ({ name, value, signal }));
  const buy = list.filter((x) => x.signal === 'BUY').length;
  const sell = list.filter((x) => x.signal === 'SELL').length;
  const neutral = list.length - buy - sell;
  const score = buy >= sell ? ((buy + neutral * 0.35) / list.length) * 10 : -((sell + neutral * 0.35) / list.length) * 10;
  const finalSignal = buy >= 14 ? 'STRONG BUY' : buy >= 10 ? 'BUY' : sell >= 14 ? 'STRONG SELL' : sell >= 10 ? 'SELL' : 'NEUTRAL';
  return { list, buy, sell, neutral, score, finalSignal };
}

function technicalMatrixSection(analysis, candles) {
  const m = technicalMatrix(analysis, candles);
  const absScore = Math.abs(m.score);
  const circumference = 2 * Math.PI * 52;
  const dash = Math.min(circumference, (absScore / 10) * circumference);
  return `<div class="card technical-matrix-card">
    <div class="card-header"><div><h3 class="card-title">Technical Analysis</h3><p class="card-subtitle">20 indicators analyzed for ${analysis.symbol}. Buy/Sell/Neutral distribution is calculated from live indicator values.</p></div></div>
    <div class="tech-overview-grid">
      <div class="tech-score-card">
        <div class="metric-label">Technical Score</div>
        <svg viewBox="0 0 140 140" class="tech-score-ring"><circle cx="70" cy="70" r="52" class="ring-bg"/><circle cx="70" cy="70" r="52" class="ring-fg ${m.score >= 0 ? 'buy-ring' : 'sell-ring'}" stroke-dasharray="${dash} ${circumference}"/><text x="70" y="77" text-anchor="middle">${formatNumber(absScore, 1)}/10</text></svg>
        ${signalBadge(m.finalSignal)}
      </div>
      <div class="tech-distribution-card">
        <div class="metric-label">Signal Distribution</div>
        <div class="tech-dist-numbers"><div><b class="pos">${m.buy}</b><span>BUY</span></div><div><b>${m.neutral}</b><span>NEUTRAL</span></div><div><b class="neg">${m.sell}</b><span>SELL</span></div></div>
        <div class="tech-dist-bar"><span class="buy" style="width:${(m.buy / m.list.length) * 100}%"></span><span class="neutral" style="width:${(m.neutral / m.list.length) * 100}%"></span><span class="sell" style="width:${(m.sell / m.list.length) * 100}%"></span></div>
      </div>
    </div>
    <div class="tech-indicator-grid">${m.list.map((row) => `<div class="tech-indicator-card"><div><b>${row.name}</b><span>Signal: ${row.signal}</span><small>${row.value}</small></div>${signalBadge(row.signal)}</div>`).join('')}</div>
  </div>`;
}

export function renderStockDetail(state, provider) {
  const symbol = state.selectedSymbol || state.analyses[0]?.symbol;
  const quote = state.snapshot.stocks.find((s) => s.symbol === symbol);
  if (!quote) return `<div class="empty-state">Select a stock from the dashboard to view complete analysis.</div>`;
  const candles = provider.getCandles(symbol, state.timeframe || '5m');
  const analysis = analyzeStock({ quote, candles, marketRegime: state.marketRegime, dataStatus: state.snapshot.status, timeframe: state.timeframe || '5m' });
  state.currentDetailAnalysis = analysis;
  const tfButtons = TIMEFRAMES.map((tf) => `<button class="button ${state.timeframe === tf.id ? 'active' : ''}" data-action="detail-timeframe" data-timeframe="${tf.id}">${tf.id}</button>`).join('');
  const actions = `<div class="toolbar">${tfButtons}<button class="button" data-action="watch" data-symbol="${symbol}">${state.watchlist.has(symbol) ? 'Remove Watch' : 'Add Watch'}</button></div>`;
  return `${pageHeader(`${symbol} — Stock Analysis`, `${quote.name}. Complete multi-timeframe analysis with live-demo candles, VWAP/EMA overlays, signal explanation, quality controls and structure-based risk plan.`, actions)}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px"><div>${dataPill(state.snapshot.status)} <span class="pill info">${quote.sector}</span> <span class="pill info">Updated ${formatDateTime(quote.timestamp)}</span></div><div>${signalBadge(analysis.signal)} ${confidenceBar(analysis.confidence, analysis.signal.includes('SELL'))}</div></div>
    <div class="split">
      <div class="card chart-card"><canvas class="chart-canvas" data-chart="stock" data-symbol="${symbol}" data-timeframe="${state.timeframe}"></canvas></div>
      <div class="summary-stack">
        <div class="summary-item"><div class="label">Overall Trend</div><div class="value">${analysis.trend}</div></div>
        <div class="summary-item"><div class="label">Momentum</div><div class="value">RSI ${formatNumber(analysis.indicators.rsi, 1)} · MACD ${formatNumber(analysis.indicators.macdHist, 2)}</div></div>
        <div class="summary-item"><div class="label">Volatility</div><div class="value">ATR ${money(analysis.indicators.atr)} · ${analysis.riskLevel}</div></div>
        <div class="summary-item"><div class="label">Volume</div><div class="value">Rel Vol ${formatNumber(analysis.quote.relVolume, 2)}x</div></div>
        <div class="summary-item"><div class="label">Buy/Sell Score</div><div class="value num">${formatNumber(analysis.score, 1)}</div></div>
        <div class="summary-item"><div class="label">Confidence</div><div class="value">${confidenceBar(analysis.confidence, analysis.signal.includes('SELL'))}</div></div>
      </div>
    </div>
    <div style="margin-top:14px">${technicalMatrixSection(analysis, candles)}</div>
    <div style="margin-top:14px">${buySellZones(analysis, state.timeframe || '5m')}</div>
    <div class="card pad" style="margin-top:14px"><h3 class="card-title">WHY THIS SIGNAL?</h3><p style="line-height:1.6;color:#d5deec">${analysis.why}</p>${qualityChips(analysis.qualityChecks)}</div>
    <div class="grid cols-2" style="margin-top:14px">
      <div class="card pad"><h3 class="card-title">Supporting Evidence</h3><ul class="explain-list">${analysis.evidence.map((e) => `<li class="good">${e}</li>`).join('') || '<li>No strong supporting evidence.</li>'}</ul></div>
      <div class="card pad"><h3 class="card-title">Conflicting Evidence / Risks</h3><ul class="explain-list">${[...analysis.conflicts, ...analysis.warnings].map((e) => `<li class="${e.includes('risk') || e.includes('warning') || e.includes('below') ? 'warn' : 'bad'}">${e}</li>`).join('') || '<li class="warn">No major conflict, but all signals remain probabilistic.</li>'}</ul></div>
    </div>
    <div style="margin-top:14px">${indicatorTable(analysis)}</div>
    <div style="margin-top:14px">${riskTable(analysis)}</div>
    <div style="margin-top:14px">${supportResistance(analysis)}</div>
    ${disclaimer()}`;
}
