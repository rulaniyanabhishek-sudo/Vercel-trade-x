import { STOCK_UNIVERSE } from '../data/universe.js';
import { analyzeStock } from '../engines/signalEngine.js';
import { confidenceBar, dataPill, money, pageHeader, signalBadge, formatDateTime, formatNumber, compact } from '../ui/render.js';
import { percentDistance, round } from '../core/utils.js';

function instrumentToolbar(state) {
  const selected = String(state.optionsInstrument || 'NIFTY');
  const selectedStock = selected.startsWith('STOCK:') ? selected.split(':')[1] : '';
  const stockOptions = STOCK_UNIVERSE
    .filter((s) => s.indices.includes('NIFTY50'))
    .map((s) => `<option value="STOCK:${s.symbol}" ${selectedStock === s.symbol ? 'selected' : ''}>${s.symbol} — ${s.name}</option>`)
    .join('');
  return `<div class="toolbar">
    <button class="button ${selected === 'NIFTY' ? 'active' : ''}" data-action="options-instrument" data-instrument="NIFTY">NIFTY</button>
    <button class="button ${selected === 'BANKNIFTY' ? 'active' : ''}" data-action="options-instrument" data-instrument="BANKNIFTY">BANK NIFTY</button>
    <select class="select" style="min-width:300px" data-input="stock-option-select">
      <option value="NIFTY" ${selected === 'NIFTY' ? 'selected' : ''}>Index: NIFTY 50</option>
      <option value="BANKNIFTY" ${selected === 'BANKNIFTY' ? 'selected' : ''}>Index: BANK NIFTY</option>
      ${stockOptions}
    </select>
  </div>`;
}

function optionPageNav() {
  return `<div class="tabs" style="margin-bottom:14px">
    <button class="tab" data-action="route" data-route="options">Overview & Stock Options</button>
    <button class="tab" data-action="route" data-route="options-chain">Option Chain & Signal History</button>
    <button class="tab active" data-action="route" data-route="options-ai">Options AI Strategies</button>
  </div>`;
}

function nearestRow(rows, price) {
  return rows.reduce((best, row) => Math.abs(row.strike - price) < Math.abs(best.strike - price) ? row : best, rows[0]);
}

function maxPain(rows) {
  if (!rows?.length) return 0;
  let best = rows[0];
  let bestPain = Infinity;
  for (const settlement of rows) {
    const pain = rows.reduce((acc, row) => acc + row.call.oi * Math.max(0, settlement.strike - row.strike) + row.put.oi * Math.max(0, row.strike - settlement.strike), 0);
    if (pain < bestPain) { bestPain = pain; best = settlement; }
  }
  return best.strike;
}

function avgIv(rows, atmStrike) {
  const near = rows.filter((r) => Math.abs(r.strike - atmStrike) <= Math.max(100, atmStrike * 0.01));
  const values = near.flatMap((r) => [r.call.iv, r.put.iv]).filter(Number.isFinite).filter((v) => v > 0);
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function ivPercentile(rows, iv) {
  const values = rows.flatMap((r) => [r.call.iv, r.put.iv]).filter(Number.isFinite).filter((v) => v > 0).sort((a, b) => a - b);
  if (!values.length || !iv) return 0;
  return Math.round((values.filter((v) => v <= iv).length / values.length) * 100);
}

function planForBuy(entry) {
  const e = Math.max(0.05, entry || 0.05);
  return { entry: e, sl: Math.max(0.05, e * 0.78), t1: e * 1.34, t2: e * 1.62 };
}

function planForSell(entry) {
  const e = Math.max(0.05, entry || 0.05);
  return { entry: e, sl: e * 1.55, t1: Math.max(0.05, e * 0.52), t2: Math.max(0.05, e * 0.32) };
}

function makeContract(underlying, strike, optionType) {
  return `${underlying} ${Math.round(strike)} ${optionType}`;
}

function cci(candles, period = 20) {
  if (!candles?.length || candles.length < period) return 0;
  const slice = candles.slice(-period);
  const tp = slice.map((c) => (c.high + c.low + c.close) / 3);
  const mean = tp.reduce((a, b) => a + b, 0) / tp.length;
  const md = tp.reduce((a, v) => a + Math.abs(v - mean), 0) / tp.length || 1;
  return (tp[tp.length - 1] - mean) / (0.015 * md);
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
    mfv += mfm * c.volume;
    vol += c.volume;
  }
  return vol ? mfv / vol : 0;
}

function obvTrend(candles) {
  if (!candles?.length || candles.length < 20) return 'NEUTRAL';
  let obv = 0;
  const arr = candles.slice(-20).map((c, i, a) => {
    if (i > 0) obv += c.close >= a[i - 1].close ? c.volume : -c.volume;
    return obv;
  });
  return arr[arr.length - 1] > arr[0] ? 'BUY' : arr[arr.length - 1] < arr[0] ? 'SELL' : 'NEUTRAL';
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

function sig(buy, sell) { return buy ? 'BUY' : sell ? 'SELL' : 'NEUTRAL'; }

function quoteAndCandlesForUnderlying(state, provider, options) {
  const instrument = String(state.optionsInstrument || 'NIFTY');
  if (instrument.startsWith('STOCK:')) {
    const symbol = instrument.split(':')[1];
    return { underlying: symbol, quote: state.snapshot.stocks.find((s) => s.symbol === symbol), candles: provider?.getCandles(symbol, '5m') || [] };
  }
  const indexSymbol = instrument === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY50';
  const idx = state.snapshot.indices.find((i) => i.symbol === indexSymbol);
  const quote = idx ? { symbol: indexSymbol, name: idx.label, ltp: idx.value, open: idx.value - idx.change, high: idx.dayHigh, low: idx.dayLow, prevClose: idx.value - idx.change, change: idx.change, changePct: idx.changePct, volume: 1000000, relVolume: 1, sector: 'Index', indices: [indexSymbol], timestamp: idx.timestamp, dataStatus: idx.dataStatus } : null;
  return { underlying: options.config?.label?.replace(/\s+/g, '') || indexSymbol, quote, candles: provider?.getIndexCandles(indexSymbol, '5m') || [] };
}

function technical20(state, provider, options) {
  const { quote, candles } = quoteAndCandlesForUnderlying(state, provider, options);
  if (!quote || !candles.length) return { rows: [], buy: 0, sell: 0, neutral: 20 };
  const analysis = analyzeStock({ quote, candles, marketRegime: state.marketRegime, dataStatus: state.snapshot.status, timeframe: '5m' });
  const i = analysis.indicators;
  const cloudTop = Math.max(i.ichimokuSpanA || quote.ltp, i.ichimokuSpanB || quote.ltp);
  const cloudBottom = Math.min(i.ichimokuSpanA || quote.ltp, i.ichimokuSpanB || quote.ltp);
  const cciVal = cci(candles);
  const mfiVal = mfi(candles);
  const cmfVal = cmf(candles);
  const wr = williamsR(candles);
  const rocVal = roc(candles);
  const obv = obvTrend(candles);
  const fibMid = i.supports?.[0] && i.resistances?.[0] ? (i.supports[0].price + i.resistances[0].price) / 2 : quote.ltp;
  const rows = [
    ['VWAP', quote.ltp > i.vwap ? 'Above' : 'Below', sig(quote.ltp > i.vwap && i.vwapSlope >= -0.02, quote.ltp < i.vwap && i.vwapSlope <= 0.02)],
    ['RSI', formatNumber(i.rsi, 1), sig(i.rsi >= 52 && i.rsi <= 72 && i.rsiSlope >= -0.2, i.rsi <= 48 && i.rsi >= 25 && i.rsiSlope <= 0.2)],
    ['Bollinger Bands', i.bbWidth < 1.2 ? 'Squeeze' : quote.ltp > i.bbBasis ? 'Upper Expansion' : 'Lower Expansion', sig(quote.ltp > i.bbBasis && i.bbWidth >= 0.6, quote.ltp < i.bbBasis && i.bbWidth >= 0.6)],
    ['Supertrend', i.supertrendDirection, i.supertrendDirection === 'BULLISH' ? 'BUY' : i.supertrendDirection === 'BEARISH' ? 'SELL' : 'NEUTRAL'],
    ['MACD', i.macdHist >= 0 ? 'Bullish' : 'Bearish', sig(i.macd > i.macdSignal && i.macdHist >= 0, i.macd < i.macdSignal && i.macdHist <= 0)],
    ['Ichimoku', quote.ltp > cloudTop ? 'Above Cloud' : quote.ltp < cloudBottom ? 'Below Cloud' : 'Inside Cloud', sig(quote.ltp > cloudTop && i.ichimokuConversion >= i.ichimokuBase, quote.ltp < cloudBottom && i.ichimokuConversion <= i.ichimokuBase)],
    ['ADX', formatNumber(i.adx, 1), sig(i.adx >= 20 && i.plusDI > i.minusDI, i.adx >= 20 && i.minusDI > i.plusDI)],
    ['Volume', `${formatNumber(quote.relVolume, 2)}x`, sig(quote.relVolume >= 0.9 && quote.changePct > 0, quote.relVolume >= 0.9 && quote.changePct < 0)],
    ['EMA Alignment', quote.ltp > i.ema20 && i.ema20 > i.ema50 ? 'Bullish stack' : quote.ltp < i.ema20 && i.ema20 < i.ema50 ? 'Bearish stack' : 'Mixed', sig(quote.ltp > i.ema20 && i.ema20 > i.ema50, quote.ltp < i.ema20 && i.ema20 < i.ema50)],
    ['Support/Resistance', quote.ltp > i.pivots.pivot ? 'Above Pivot' : 'Below Pivot', sig(quote.ltp > i.pivots.pivot, quote.ltp < i.pivots.pivot)],
    ['EMA 20', quote.ltp > i.ema20 ? 'Above' : 'Below', sig(quote.ltp > i.ema20, quote.ltp < i.ema20)],
    ['EMA 50', quote.ltp > i.ema50 ? 'Above' : 'Below', sig(quote.ltp > i.ema50, quote.ltp < i.ema50)],
    ['CCI', formatNumber(cciVal, 1), sig(cciVal > 50, cciVal < -50)],
    ['MFI', formatNumber(mfiVal, 1), sig(mfiVal >= 52 && mfiVal < 85, mfiVal <= 48 && mfiVal > 15)],
    ['OBV', obv, obv],
    ['CMF', formatNumber(cmfVal, 3), sig(cmfVal > 0, cmfVal < 0)],
    ['ATR', money(i.atr), 'NEUTRAL'],
    ['Stochastic RSI', formatNumber(i.stochK, 1), sig(i.stochK > i.stochD && i.stochK < 85, i.stochK < i.stochD && i.stochK > 15)],
    ['Williams %R', formatNumber(wr, 1), sig(wr > -50, wr < -50)],
    ['Fibonacci', quote.ltp > fibMid ? 'Above Mid-Zone' : 'Below Mid-Zone', sig(quote.ltp > fibMid, quote.ltp < fibMid)]
  ].map(([name, value, signal]) => ({ name, value, signal }));
  return { rows, buy: rows.filter((r) => r.signal === 'BUY').length, sell: rows.filter((r) => r.signal === 'SELL').length, neutral: rows.filter((r) => r.signal === 'NEUTRAL').length, analysis };
}

function chooseRows(options) {
  const rows = options.chain.rows;
  const spot = options.totals.spot || options.chain.spot || 0;
  const atm = options.highlights.atm || nearestRow(rows, spot).strike;
  const atmRow = nearestRow(rows, atm);
  const callBuy = rows.find((r) => r.strike >= atm) || atmRow;
  const putBuy = [...rows].reverse().find((r) => r.strike <= atm) || atmRow;
  const sellCe = rows.find((r) => r.strike === options.highlights.majorResistance) || rows.find((r) => r.strike > atm) || atmRow;
  const sellPe = rows.find((r) => r.strike === options.highlights.majorSupport) || [...rows].reverse().find((r) => r.strike < atm) || atmRow;
  return { callBuy, putBuy, sellCe, sellPe };
}

function strategyScore({ direction, leg, row, options, technical }) {
  const t = options.totals;
  const signal = options.signal.combinedSignal || '';
  const techAgree = direction > 0 ? technical.buy : technical.sell;
  const optionVotes = direction > 0
    ? [t.pcr > 1, t.putWriting >= t.callWriting, t.priceVsVwap >= -0.1, !signal.includes('STRONG SELL'), row.strike >= t.spot - options.config.step, leg.oi > 0, leg.iv > 0]
    : [t.pcr < 1 || t.callWriting > t.putWriting, t.callWriting >= t.putWriting, t.priceVsVwap <= 0.1, !signal.includes('STRONG BUY'), row.strike <= t.spot + options.config.step, leg.oi > 0, leg.iv > 0];
  const ov = optionVotes.filter(Boolean).length;
  const confidence = Math.min(96, Math.round(techAgree * 3.2 + ov * 5.4 + Math.abs(options.signal.combinedScore || 0) * 0.18 + 18));
  return { techAgree, optionVotes: ov, confirmations: techAgree + ov, confidence };
}

function makeStrategies(options, state, provider) {
  const rows = chooseRows(options);
  const underlying = options.config?.symbol || (options.instrument === 'BANKNIFTY' ? 'BANKNIFTY' : 'NIFTY');
  const technical = technical20(state, provider, options);
  const raw = [
    { type: 'BUY CE', optionType: 'CE', direction: 1, row: rows.callBuy, leg: rows.callBuy.call, plan: planForBuy(rows.callBuy.call.ltp), tone: 'buy' },
    { type: 'BUY PE', optionType: 'PE', direction: -1, row: rows.putBuy, leg: rows.putBuy.put, plan: planForBuy(rows.putBuy.put.ltp), tone: 'buy-pe' },
    { type: 'SELL CE', optionType: 'CE', direction: -1, row: rows.sellCe, leg: rows.sellCe.call, plan: planForSell(rows.sellCe.call.ltp), tone: 'sell-ce' },
    { type: 'SELL PE', optionType: 'PE', direction: 1, row: rows.sellPe, leg: rows.sellPe.put, plan: planForSell(rows.sellPe.put.ltp), tone: 'sell-pe' }
  ];
  return raw.map((s) => {
    const score = strategyScore({ direction: s.direction, leg: s.leg, row: s.row, options, technical });
    const contract = makeContract(underlying, s.row.strike, s.optionType);
    const reason = s.direction > 0
      ? `${contract}: bullish technical alignment ${score.techAgree}/20 plus option confirmations ${score.optionVotes}/7.`
      : `${contract}: bearish/hedge alignment ${score.techAgree}/20 plus option confirmations ${score.optionVotes}/7.`;
    return { ...s, ...score, contract, reason, technical };
  }).sort((a, b) => b.confidence - a.confidence);
}

function optionFlowSummary(options) {
  const totalCallChange = (options.chain?.rows || []).reduce((acc, row) => acc + (row.call?.changeOI || 0), 0);
  const totalPutChange = (options.chain?.rows || []).reduce((acc, row) => acc + (row.put?.changeOI || 0), 0);
  return `<div class="grid cols-3 option-flow-summary">
    <div class="card pad"><div class="metric-label">PCR (Put / Call Ratio)</div><div class="metric-value num ${options.totals.pcr >= 1 ? 'pos' : 'neg'}">${formatNumber(options.totals.pcr, 2)}</div><p class="card-subtitle">Total Put OI ÷ Total Call OI</p></div>
    <div class="card pad"><div class="metric-label">Total Call OI Change</div><div class="metric-value num ${totalCallChange >= 0 ? 'pos' : 'neg'}">${totalCallChange > 0 ? '+' : ''}${formatNumber(totalCallChange, 0)}</div><p class="card-subtitle">Total change in Call open interest</p></div>
    <div class="card pad"><div class="metric-label">Total Put OI Change</div><div class="metric-value num ${totalPutChange >= 0 ? 'pos' : 'neg'}">${totalPutChange > 0 ? '+' : ''}${formatNumber(totalPutChange, 0)}</div><p class="card-subtitle">Total change in Put open interest</p></div>
  </div>`;
}

function strategyCard(strategy, bestContract) {
  const badgeClass = strategy.tone.includes('sell') ? 'strategy-sell' : 'strategy-buy';
  const isBest = strategy.contract === bestContract;
  return `<div class="option-ai-card ${strategy.tone} ${isBest ? 'best-option-card' : ''}">
    <div class="option-ai-head"><div><span class="strategy-badge ${badgeClass}">${strategy.type}</span>${isBest ? '<span class="pill positive">AI BEST CHOICE</span>' : '<span class="pill info">Alternative</span>'}<h3 class="option-contract-title">${strategy.contract}</h3><p class="muted small">Exact contract: ${strategy.contract}</p></div><b>${strategy.confidence}%</b></div>
    <div class="option-ai-grid">
      <div><span>Contract</span><b>${strategy.contract}</b></div>
      <div><span>Strike</span><b>${formatNumber(strategy.row.strike, 0)} ${strategy.optionType}</b></div>
      <div><span>Tech Confirmations</span><b>${strategy.techAgree}/20</b></div>
      <div><span>Option Confirmations</span><b>${strategy.optionVotes}/7</b></div>
      <div><span>Entry</span><b>${money(strategy.plan.entry)}</b></div>
      <div><span>Target</span><b class="pos">${money(strategy.plan.t1)}</b></div>
      <div><span>Target 2</span><b class="pos">${money(strategy.plan.t2)}</b></div>
      <div><span>Stop Loss</span><b class="neg">${money(strategy.plan.sl)}</b></div>
      <div><span>OI</span><b>${formatNumber(strategy.leg.oi, 0)}</b></div>
      <div><span>OI Change</span><b class="${strategy.leg.changeOI >= 0 ? 'pos' : 'neg'}">${strategy.leg.changeOI > 0 ? '+' : ''}${formatNumber(strategy.leg.changeOI, 0)}</b></div>
      <div><span>IV</span><b>${formatNumber(strategy.leg.iv, 2)}%</b></div>
    </div>
    <div class="option-ai-reason">💡 ${strategy.reason}</div>
  </div>`;
}

function strategyScoreboard(strategies) {
  return `<div class="card option-scoreboard"><div class="card-header"><div><h3 class="card-title">How to choose the correct option?</h3><p class="card-subtitle">The highest AI score is marked as AI BEST CHOICE. Scores combine all 20 technical indicators plus PCR, Call/Put OI change, VWAP and option-chain confirmations.</p></div></div><div style="padding:16px"><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Contract</th><th>Action</th><th>Confidence</th><th>Tech Confirmations</th><th>Option Confirmations</th><th>Entry</th><th>SL</th><th>Target</th></tr></thead><tbody>${strategies.map((s, i) => `<tr><td>${i + 1}</td><td><b>${s.contract}</b></td><td>${signalBadge(s.type.includes('BUY') ? 'BUY' : 'SELL')}</td><td>${confidenceBar(s.confidence, s.direction < 0)}</td><td>${s.techAgree}/20</td><td>${s.optionVotes}/7</td><td>${money(s.plan.entry)}</td><td>${money(s.plan.sl)}</td><td>${money(s.plan.t1)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

function technicalMatrix(technical) {
  return `<div class="card option-tech-matrix"><div class="card-header"><div><h3 class="card-title">20-Indicator Technical Confirmation</h3><p class="card-subtitle">Used to rank every CE/PE strategy for the selected underlying.</p></div><div class="toolbar"><span class="pill positive">Buy ${technical.buy}</span><span class="pill negative">Sell ${technical.sell}</span><span class="pill warning">Neutral ${technical.neutral}</span></div></div><div class="tech-indicator-grid" style="padding:16px">${technical.rows.map((r) => `<div class="tech-indicator-card"><div><b>${r.name}</b><span>${r.value}</span></div>${signalBadge(r.signal)}</div>`).join('')}</div></div>`;
}

export function renderOptionsAI(state, provider) {
  const options = state.options;
  if (!options) return '<div class="empty-state">Options AI is waiting for market data.</div>';
  const rows = options.chain.rows || [];
  const mp = maxPain(rows);
  const iv = avgIv(rows, options.highlights.atm);
  const ivp = ivPercentile(rows, iv);
  const strategies = makeStrategies(options, state, provider);
  const best = strategies[0];
  return `${pageHeader('Options AI Strategies', 'Professional options analysis with exact CE/PE contract labels and AI ranking for the selected index or NIFTY 50 stock.', instrumentToolbar(state))}
    ${optionPageNav()}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px">
      <div>${dataPill(state.snapshot.status)} <span class="pill info">Underlying ${options.config.label}</span> <span class="pill info">Last update ${formatDateTime(state.snapshot.timestamp)}</span></div>
      <div>${best ? `<span class="pill positive">Best: ${best.contract}</span>` : ''}</div>
    </div>
    ${optionFlowSummary(options)}
    <div class="grid cols-4 option-ai-metrics">
      <div class="card pad"><div class="metric-label">PCR Bias</div><div class="metric-value num ${options.totals.pcr >= 1 ? 'pos' : 'neg'}">${options.totals.pcr >= 1 ? 'Bullish' : 'Bearish'}</div><div class="muted small">PCR ${formatNumber(options.totals.pcr, 2)}</div></div>
      <div class="card pad"><div class="metric-label">Max Pain</div><div class="metric-value num">₹${formatNumber(mp, 0)}</div></div>
      <div class="card pad"><div class="metric-label">IV</div><div class="metric-value num">${formatNumber(iv, 1)}%</div></div>
      <div class="card pad"><div class="metric-label">IV Percentile</div><div class="metric-value num ${ivp > 70 ? 'neg' : ivp < 35 ? 'pos' : ''}">${formatNumber(ivp, 0)}%</div></div>
    </div>
    ${strategyScoreboard(strategies)}
    <div class="option-ai-grid-cards">${strategies.map((s) => strategyCard(s, best?.contract)).join('')}</div>
    ${best ? technicalMatrix(best.technical) : ''}
    <div class="warning-panel" style="margin-top:14px"><b>Accuracy note:</b> Use the card marked AI BEST CHOICE. It is selected by ranking all four CE/PE actions with all 20 technical indicators plus PCR, total Call OI change, total Put OI change, VWAP and option-chain structure. For exchange-certified real-time option data, connect Render backend with Upstox.</div>`;
}
