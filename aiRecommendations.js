import { analyzeStock } from '../engines/signalEngine.js';
import { compact, confidenceBar, dataPill, disclaimer, money, pageHeader, signalBadge, formatNumber, formatDateTime } from '../ui/render.js';
import { directionClass, percentDistance, round } from '../core/utils.js';

const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1h', '1d', '1w'];
const INDICATOR_NAMES = ['VWAP', 'RSI', 'Bollinger Bands', 'Supertrend', 'MACD', 'Ichimoku', 'ADX', 'Volume', 'EMA Alignment', 'Support/Resistance'];

function sideOf(signal = '') {
  if (signal.includes('BUY')) return 1;
  if (signal.includes('SELL')) return -1;
  return 0;
}

function recLabel(side, confidence) {
  if (side > 0) return confidence >= 90 ? 'STRONG BUY' : 'BUY';
  if (side < 0) return confidence >= 90 ? 'STRONG SELL' : 'SELL';
  return 'NEUTRAL';
}

function starRating(score) {
  const count = score >= 92 ? 5 : score >= 84 ? 4 : 3;
  return '★'.repeat(count) + '☆'.repeat(5 - count);
}

function latest(candles) { return candles?.[candles.length - 1]; }
function prev(candles) { return candles?.[candles.length - 2] || candles?.[candles.length - 1]; }

function cci(candles, period = 20) {
  if (!candles?.length || candles.length < period) return 0;
  const slice = candles.slice(-period);
  const typical = slice.map((c) => (c.high + c.low + c.close) / 3);
  const mean = typical.reduce((a, b) => a + b, 0) / typical.length;
  const md = typical.reduce((a, v) => a + Math.abs(v - mean), 0) / typical.length || 1;
  return round((typical[typical.length - 1] - mean) / (0.015 * md), 1);
}

function mfi(candles, period = 14) {
  if (!candles?.length || candles.length < period + 1) return 50;
  let pos = 0; let neg = 0;
  const slice = candles.slice(-period - 1);
  for (let i = 1; i < slice.length; i += 1) {
    const tp = (slice[i].high + slice[i].low + slice[i].close) / 3;
    const prevTp = (slice[i - 1].high + slice[i - 1].low + slice[i - 1].close) / 3;
    const flow = tp * slice[i].volume;
    if (tp >= prevTp) pos += flow; else neg += flow;
  }
  if (!neg) return 100;
  return round(100 - (100 / (1 + pos / neg)), 1);
}

function obvTrend(candles, lookback = 20) {
  if (!candles?.length || candles.length < lookback) return 'Flat';
  let obv = 0;
  const series = candles.slice(-lookback).map((c, i, arr) => {
    if (i > 0) obv += c.close >= arr[i - 1].close ? c.volume : -c.volume;
    return obv;
  });
  const change = series[series.length - 1] - series[0];
  return change > 0 ? 'Increasing' : change < 0 ? 'Decreasing' : 'Flat';
}

function cmf(candles, period = 20) {
  if (!candles?.length || candles.length < period) return 0;
  const slice = candles.slice(-period);
  let mfv = 0; let vol = 0;
  for (const c of slice) {
    const mfm = (c.high === c.low) ? 0 : ((c.close - c.low) - (c.high - c.close)) / (c.high - c.low);
    mfv += mfm * c.volume;
    vol += c.volume;
  }
  return round(vol ? mfv / vol : 0, 3);
}

function detectCandle(candles) {
  const c = latest(candles); const p = prev(candles);
  if (!c) return { pattern: 'No data', probability: 0, type: 'Neutral', side: 0 };
  const body = Math.abs(c.close - c.open);
  const range = Math.max(0.01, c.high - c.low);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;
  if (body / range < 0.12) return { pattern: 'Doji', probability: 54, type: 'Indecision', side: 0 };
  if (lower > body * 2 && upper < body * 0.7) return { pattern: c.close >= c.open ? 'Hammer' : 'Hanging Man', probability: 63, type: 'Reversal', side: c.close >= c.open ? 1 : -1 };
  if (upper > body * 2 && lower < body * 0.7) return { pattern: c.close >= c.open ? 'Inverted Hammer' : 'Shooting Star', probability: 61, type: 'Reversal', side: c.close >= c.open ? 1 : -1 };
  if (p) {
    const bullEngulf = c.close > c.open && p.close < p.open && c.close > p.open && c.open < p.close;
    const bearEngulf = c.close < c.open && p.close > p.open && c.open > p.close && c.close < p.open;
    if (bullEngulf) return { pattern: 'Bullish Engulfing', probability: 68, type: 'Continuation/Reversal', side: 1 };
    if (bearEngulf) return { pattern: 'Bearish Engulfing', probability: 68, type: 'Continuation/Reversal', side: -1 };
    if (c.high <= p.high && c.low >= p.low) return { pattern: 'Inside Bar', probability: 58, type: 'Breakout Pending', side: 0 };
    if (c.high >= p.high && c.low <= p.low) return { pattern: 'Outside Bar', probability: 60, type: 'Volatility Expansion', side: c.close >= c.open ? 1 : -1 };
  }
  if (body / range > 0.8) return { pattern: c.close > c.open ? 'Bullish Marubozu' : 'Bearish Marubozu', probability: 66, type: 'Continuation', side: c.close > c.open ? 1 : -1 };
  return { pattern: c.close >= c.open ? 'Bullish Candle' : 'Bearish Candle', probability: 52, type: 'Continuation', side: c.close >= c.open ? 1 : -1 };
}

function detectTrendline(candles, side) {
  if (!candles?.length || candles.length < 25) return { pattern: 'Insufficient pattern data', confidence: 0 };
  const recent = candles.slice(-25);
  const firstHigh = Math.max(...recent.slice(0, 8).map((c) => c.high));
  const lastHigh = Math.max(...recent.slice(-8).map((c) => c.high));
  const firstLow = Math.min(...recent.slice(0, 8).map((c) => c.low));
  const lastLow = Math.min(...recent.slice(-8).map((c) => c.low));
  const highSlope = percentDistance(lastHigh, firstHigh);
  const lowSlope = percentDistance(lastLow, firstLow);
  const price = latest(recent).close;
  if (Math.abs(highSlope) < 0.25 && lowSlope > 0.35) return { pattern: side > 0 ? 'Ascending Triangle / Breakout Build-up' : 'Ascending Triangle Resistance Risk', confidence: 72 };
  if (Math.abs(lowSlope) < 0.25 && highSlope < -0.35) return { pattern: side < 0 ? 'Descending Triangle / Breakdown Build-up' : 'Descending Triangle Support Risk', confidence: 72 };
  if (highSlope > 0.35 && lowSlope > 0.35) return { pattern: 'Rising Channel / Higher High Higher Low', confidence: side > 0 ? 78 : 55 };
  if (highSlope < -0.35 && lowSlope < -0.35) return { pattern: 'Falling Channel / Lower High Lower Low', confidence: side < 0 ? 78 : 55 };
  if (price > firstHigh) return { pattern: 'Breakout above recent resistance', confidence: 74 };
  if (price < firstLow) return { pattern: 'Breakdown below recent support', confidence: 74 };
  return { pattern: 'Rectangle / Consolidation', confidence: 54 };
}

function gapAnalysis(quote) {
  const gap = percentDistance(quote.open, quote.prevClose);
  const type = gap > 0.35 ? 'Gap Up' : gap < -0.35 ? 'Gap Down' : 'No major gap';
  const fillProbability = Math.min(82, Math.max(18, 45 + Math.abs(gap) * 12));
  return { type, gap: round(gap, 2), fillProbability: round(fillProbability, 0) };
}

function indicatorConfirmations(analysis, candles) {
  const q = analysis.quote;
  const i = analysis.indicators;
  const close = q.ltp;
  const bbMid = i.bbBasis || close;
  const cloudTop = Math.max(i.ichimokuSpanA || close, i.ichimokuSpanB || close);
  const cloudBottom = Math.min(i.ichimokuSpanA || close, i.ichimokuSpanB || close);
  const priceSlope = candles?.length > 6 ? percentDistance(close, candles[candles.length - 6].close) : q.changePct;
  const pivot = i.pivots?.pivot || close;
  const support = [...(i.supports || [])].filter((s) => s.price < close).sort((a, b) => b.price - a.price)[0]?.price;
  const resistance = [...(i.resistances || [])].filter((r) => r.price > close).sort((a, b) => a.price - b.price)[0]?.price;
  const rows = [
    { name: 'VWAP', value: close >= i.vwap ? 'Above VWAP' : 'Below VWAP', side: close > i.vwap && i.vwapSlope >= -0.02 ? 1 : close < i.vwap && i.vwapSlope <= 0.02 ? -1 : 0 },
    { name: 'RSI', value: formatNumber(i.rsi, 1), side: i.rsi >= 52 && i.rsi <= 72 && i.rsiSlope >= -0.1 ? 1 : i.rsi <= 48 && i.rsi >= 25 && i.rsiSlope <= 0.1 ? -1 : 0 },
    { name: 'Bollinger Bands', value: close >= bbMid ? 'Upper half' : 'Lower half', side: close > bbMid && i.bbWidth >= 0.6 ? 1 : close < bbMid && i.bbWidth >= 0.6 ? -1 : 0 },
    { name: 'Supertrend', value: i.supertrendDirection, side: i.supertrendDirection === 'BULLISH' ? 1 : i.supertrendDirection === 'BEARISH' ? -1 : 0 },
    { name: 'MACD', value: i.macdHist >= 0 ? 'Bullish' : 'Bearish', side: i.macd > i.macdSignal && i.macdHist >= 0 ? 1 : i.macd < i.macdSignal && i.macdHist <= 0 ? -1 : 0 },
    { name: 'Ichimoku', value: close > cloudTop ? 'Above cloud' : close < cloudBottom ? 'Below cloud' : 'Inside cloud', side: close > cloudTop && i.ichimokuConversion >= i.ichimokuBase ? 1 : close < cloudBottom && i.ichimokuConversion <= i.ichimokuBase ? -1 : 0 },
    { name: 'ADX', value: formatNumber(i.adx, 1), side: i.adx >= 20 && i.plusDI > i.minusDI ? 1 : i.adx >= 20 && i.minusDI > i.plusDI ? -1 : 0 },
    { name: 'Volume', value: `${formatNumber(q.relVolume, 2)}x`, side: q.relVolume >= 0.9 && priceSlope > 0 ? 1 : q.relVolume >= 0.9 && priceSlope < 0 ? -1 : 0 },
    { name: 'EMA Alignment', value: close > i.ema20 && i.ema20 > i.ema50 ? 'Bullish stack' : close < i.ema20 && i.ema20 < i.ema50 ? 'Bearish stack' : 'Mixed', side: close > i.ema20 && i.ema20 > i.ema50 ? 1 : close < i.ema20 && i.ema20 < i.ema50 ? -1 : 0 },
    { name: 'Support/Resistance', value: close > pivot ? 'Above pivot' : 'Below pivot', side: close > pivot && (!resistance || percentDistance(resistance, close) > 0.35) ? 1 : close < pivot && (!support || percentDistance(close, support) > 0.35) ? -1 : 0 }
  ];
  return rows;
}

function timeFrameAgreement(quote, provider, marketRegime, side) {
  const rows = TIMEFRAMES.map((tf) => {
    const analysis = analyzeStock({ quote, candles: provider.getCandles(quote.symbol, tf), marketRegime, dataStatus: quote.dataStatus, timeframe: tf });
    const s = sideOf(analysis.signal);
    return { tf, signal: analysis.signal, agree: s === side, score: analysis.score };
  });
  const agree = rows.filter((r) => r.agree).length;
  return { rows, alignment: round((agree / rows.length) * 100, 0) };
}

function supportResistanceText(analysis, price) {
  const supports = [...(analysis.indicators.supports || [])].filter((s) => s.price < price).sort((a, b) => b.price - a.price).slice(0, 3);
  const resistances = [...(analysis.indicators.resistances || [])].filter((r) => r.price > price).sort((a, b) => a.price - b.price).slice(0, 3);
  return { supports, resistances, nearestSupport: supports[0]?.price, nearestResistance: resistances[0]?.price };
}

function candidateFromAnalysis(analysis, provider, state) {
  const candles = provider.getCandles(analysis.symbol, '5m');
  const confirmations = indicatorConfirmations(analysis, candles);
  const buyVotes = confirmations.filter((x) => x.side > 0).length;
  const sellVotes = confirmations.filter((x) => x.side < 0).length;
  const side = buyVotes >= 7 ? 1 : sellVotes >= 7 ? -1 : 0;
  if (!side) return null;
  const tf = timeFrameAgreement(analysis.quote, provider, state.marketRegime, side);
  const candle = detectCandle(candles);
  const trendline = detectTrendline(candles, side);
  const gap = gapAnalysis(analysis.quote);
  const sr = supportResistanceText(analysis, analysis.quote.ltp);
  const mfiValue = mfi(candles);
  const cciValue = cci(candles);
  const obv = obvTrend(candles);
  const cmfValue = cmf(candles);
  const alignedVotes = side > 0 ? buyVotes : sellVotes;
  const rrBoost = Math.min(8, (analysis.riskPlan.rr || 0) * 1.5);
  const confidence = Math.min(98, Math.round(alignedVotes * 9 + tf.alignment * 0.12 + Math.abs(analysis.score) * 0.12 + rrBoost));
  if (confidence < 80) return null;
  const vix = state.snapshot.indices.find((idx) => idx.symbol === 'INDIAVIX')?.value || 14;
  const newsRisk = vix > 18 ? 'High VIX — reduce confidence' : 'News/VIX filter normal';
  return { analysis, quote: analysis.quote, side, confirmations, buyVotes, sellVotes, alignedVotes, confidence, recommendation: recLabel(side, confidence), tf, candle, trendline, gap, sr, mfiValue, cciValue, obv, cmfValue, newsRisk };
}

function scoreBreakdown(candidate) {
  const rows = [['VWAP', 10], ['RSI', 10], ['MACD', 10], ['Supertrend', 10], ['Ichimoku', 10], ['ADX', 10], ['Volume', 10], ['Bollinger', 10], ['Support/Resistance', 10], ['Price Action', 10]];
  return `<div class="score-breakdown">${rows.map(([k, v]) => `<div><span>${k}</span><b>${v}%</b></div>`).join('')}<div class="final"><span>Final Score</span><b>${candidate.confidence}%</b></div></div>`;
}

function indicatorTable(candidate) {
  const a = candidate.analysis;
  const i = a.indicators;
  const base = candidate.confirmations.map((x) => [x.name, x.value, x.side]);
  const extra = [['CCI', formatNumber(candidate.cciValue, 1), Math.sign(candidate.cciValue)], ['MFI', formatNumber(candidate.mfiValue, 1), candidate.mfiValue >= 52 ? 1 : candidate.mfiValue <= 48 ? -1 : 0], ['OBV', candidate.obv, candidate.obv === 'Increasing' ? 1 : candidate.obv === 'Decreasing' ? -1 : 0], ['CMF', formatNumber(candidate.cmfValue, 3), Math.sign(candidate.cmfValue)], ['ATR', money(i.atr), 0], ['Pivot', a.quote.ltp > i.pivots.pivot ? 'Above Pivot' : 'Below Pivot', a.quote.ltp > i.pivots.pivot ? 1 : -1]];
  return `<div class="mini-indicator-table">${[...base, ...extra].map(([k, v, side]) => `<div><span>${k}</span><b class="${side > 0 ? 'pos' : side < 0 ? 'neg' : ''}">${v}</b></div>`).join('')}</div>`;
}

function tfAgreement(candidate) {
  return `<div class="tf-grid">${candidate.tf.rows.map((r) => `<div><span>${r.tf}</span>${signalBadge(r.signal)}</div>`).join('')}<div class="alignment"><span>Overall Alignment</span><b>${candidate.tf.alignment}%</b></div></div>`;
}

function tradeStatus(candidate) {
  const rp = candidate.analysis.riskPlan;
  const price = candidate.quote.ltp;
  if (candidate.confidence >= 90) return 'Fresh Entry';
  if (candidate.side > 0 && rp.entryHigh && price > rp.entryHigh) return 'Entry Missed';
  if (candidate.side < 0 && rp.entryLow && price < rp.entryLow) return 'Entry Missed';
  return 'Near Entry';
}

function tradeCard(candidate) {
  const a = candidate.analysis;
  const rp = a.riskPlan;
  const sideWord = candidate.side > 0 ? 'Buy' : 'Sell';
  const entry = rp.entryLow && rp.entryHigh ? `${money(rp.entryLow)} – ${money(rp.entryHigh)}` : 'Wait for setup';
  const rewardPct = candidate.side > 0 && rp.target2 ? percentDistance(rp.target2, a.quote.ltp) : candidate.side < 0 && rp.target2 ? percentDistance(a.quote.ltp, rp.target2) : 0;
  const sr = candidate.sr;
  const newsRisk = candidate.newsRisk;
  return `<div class="ai-rec-card ${candidate.side > 0 ? 'buy-card' : 'sell-card'}">
    <div class="ai-rec-main-row">
      <div><div>${signalBadge(candidate.recommendation)} <span class="stars">${starRating(candidate.confidence)} ${candidate.confidence}%</span></div><h3>${a.symbol}</h3><p>${a.name} • ${candidate.alignedVotes}/10 Confirmations • ${candidate.tf.alignment}% TF Alignment</p></div>
      <div class="ai-price-grid"><div><span>Entry Zone</span><b>${entry}</b></div><div><span>Stop Loss</span><b class="neg">${rp.standardStop ? money(rp.standardStop) : '—'}</b></div><div><span>Target 1</span><b class="pos">${rp.target1 ? money(rp.target1) : '—'}</b></div><div><span>Target 2</span><b class="pos">${rp.target2 ? money(rp.target2) : '—'}</b></div></div>
    </div>
    <div class="ai-meta-line"><span>⏰ ${candidate.tf.alignment >= 85 ? '1 Hour / Till Close' : '15–30 Minutes'}</span><span>🎯 RR 1:${formatNumber(rp.rr, 2)}</span><span>💰 Risk ${formatNumber(rp.riskPct || 0, 2)}%</span><span>📊 Reward ${formatNumber(Math.abs(rewardPct), 2)}%</span><span>🟢 ${newsRisk}</span><span>📌 ${tradeStatus(candidate)}</span></div>
    <div class="ai-section"><b>AI Reasoning</b><ul class="explain-list">${candidate.confirmations.filter((x) => x.side === candidate.side).slice(0, 10).map((x) => `<li class="good">✔ ${x.name}: ${x.value}</li>`).join('')}<li class="good">✔ ${candidate.trendline.pattern} (${candidate.trendline.confidence}%)</li><li class="good">✔ Candlestick: ${candidate.candle.pattern} (${candidate.candle.probability}%)</li></ul></div>
    <div class="ai-section"><b>Timeframe Agreement</b>${tfAgreement(candidate)}</div>
    <div class="ai-section"><b>Indicator Table</b>${indicatorTable(candidate)}</div>
    <div class="ai-section"><b>Support & Resistance</b><div class="sr-grid"><div><span>Support 1</span><b>${sr.supports[0] ? money(sr.supports[0].price) : '—'}</b></div><div><span>Support 2</span><b>${sr.supports[1] ? money(sr.supports[1].price) : '—'}</b></div><div><span>Support 3</span><b>${sr.supports[2] ? money(sr.supports[2].price) : '—'}</b></div><div><span>Resistance 1</span><b>${sr.resistances[0] ? money(sr.resistances[0].price) : '—'}</b></div><div><span>Resistance 2</span><b>${sr.resistances[1] ? money(sr.resistances[1].price) : '—'}</b></div><div><span>Resistance 3</span><b>${sr.resistances[2] ? money(sr.resistances[2].price) : '—'}</b></div><div><span>Nearest Support Distance</span><b>${sr.nearestSupport ? formatNumber(Math.abs(percentDistance(a.quote.ltp, sr.nearestSupport)), 2) + '%' : '—'}</b></div><div><span>Nearest Resistance Distance</span><b>${sr.nearestResistance ? formatNumber(Math.abs(percentDistance(sr.nearestResistance, a.quote.ltp)), 2) + '%' : '—'}</b></div></div></div>
    <div class="ai-section"><b>Trendline / Candlestick / Volume / Gap</b><div class="sr-grid"><div><span>Trendline</span><b>${candidate.trendline.pattern}</b></div><div><span>Candlestick</span><b>${candidate.candle.pattern}</b></div><div><span>Volume Spike</span><b>${a.quote.relVolume >= 1.5 ? 'Yes' : 'No'} (${formatNumber(a.quote.relVolume, 2)}x)</b></div><div><span>Avg Volume</span><b>${compact(a.quote.avgVolume)}</b></div><div><span>Current Volume</span><b>${compact(a.quote.volume)}</b></div><div><span>Gap</span><b>${candidate.gap.type} ${candidate.gap.gap}%</b></div><div><span>Gap Fill Probability</span><b>${candidate.gap.fillProbability}%</b></div><div><span>Smart Money</span><b>${a.quote.relVolume > 1.3 ? 'Possible accumulation' : 'Normal'}</b></div></div></div>
    <div class="ai-section"><b>AI Score Breakdown</b>${scoreBreakdown(candidate)}</div>
    <div class="ai-alert-row"><span class="pill info">Alert: Entry Reached</span><span class="pill warning">Alert: SL Hit</span><span class="pill positive">Alert: Target Hit</span><span class="pill info">Alert: VWAP/MACD/PCR Shift</span></div>
  </div>`;
}

function stateVix(analysis) {
  return analysis?.marketRegime?.vix || 14;
}

function buildIntradayRecommendations(state, provider) {
  const filter = state.aiFilter || 'all';
  return state.analyses
    .map((analysis) => candidateFromAnalysis(analysis, provider, state))
    .filter(Boolean)
    .filter((c) => {
      if (filter === 'strongBuy') return c.recommendation === 'STRONG BUY';
      if (filter === 'buy') return c.recommendation.includes('BUY');
      if (filter === 'sell') return c.recommendation.includes('SELL');
      if (filter === 'strongSell') return c.recommendation === 'STRONG SELL';
      if (filter === 'confidence90') return c.confidence >= 90;
      if (filter === 'confidence80') return c.confidence >= 80;
      if (['Banking', 'IT', 'Pharma', 'Auto', 'PSU', 'Midcap', 'Smallcap'].includes(filter)) return c.quote.sector === filter;
      if (filter === 'nifty50') return c.quote.indices.includes('NIFTY50');
      if (filter === 'sensex') return c.quote.indices.includes('SENSEX');
      if (filter === 'fno') return c.quote.indices.includes('NIFTY50') || c.quote.indices.includes('BANKNIFTY');
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);
}

function optionRecommendations(state) {
  const table = state.niftyTable;
  if (!table?.rows?.length) return [];
  const reading = table.reading;
  const rows = table.rows.map((row) => {
    const ceScore = [reading.pcr > 1, reading.diff > 0, reading.putChangeOI > reading.callChangeOI, reading.currentPrice >= reading.vwap, row.call.changeOI <= row.put.changeOI, row.call.ltp > 0, row.call.iv > 0, Math.abs(row.strike - table.spot) <= 150, reading.optionSignal === 'BUY', reading.vwapSignal !== 'SELL'].filter(Boolean).length;
    const peScore = [reading.pcr < 1, reading.diff < 0, reading.callChangeOI > reading.putChangeOI, reading.currentPrice <= reading.vwap, row.put.changeOI <= row.call.changeOI, row.put.ltp > 0, row.put.iv > 0, Math.abs(row.strike - table.spot) <= 150, reading.optionSignal === 'SELL', reading.vwapSignal !== 'BUY'].filter(Boolean).length;
    return [{ type: 'CE', side: 1, row, leg: row.call, votes: ceScore }, { type: 'PE', side: -1, row, leg: row.put, votes: peScore }];
  }).flat().filter((r) => r.votes >= 7).sort((a, b) => b.votes - a.votes).slice(0, 4);
  return rows.map((r) => {
    const entry = r.leg.ltp;
    const risk = Math.max(entry * 0.14, 2);
    const confidence = Math.min(96, 62 + r.votes * 4);
    return { ...r, contract: `NIFTY ${r.row.strike} ${r.type}`, entry, sl: Math.max(0.05, entry - risk), t1: entry + risk * 1.45, t2: entry + risk * 2.2, confidence, reading, atm: table.atmStrike, table };
  });
}

function optionTradeCard(rec) {
  return `<div class="ai-rec-card ${rec.side > 0 ? 'buy-card' : 'sell-card'}"><div class="ai-rec-main-row"><div><div>${signalBadge(rec.side > 0 ? 'BUY' : 'SELL')} <span class="stars">${starRating(rec.confidence)} ${rec.confidence}%</span></div><h3>${rec.contract}</h3><p>ATM ${rec.atm} • ${rec.votes}/10 confirmations • ${rec.side > 0 ? 'Bullish option setup' : 'Bearish option setup'}</p></div><div class="ai-price-grid"><div><span>Entry</span><b>${money(rec.entry)}</b></div><div><span>Stop Loss</span><b class="neg">${money(rec.sl)}</b></div><div><span>Target 1</span><b class="pos">${money(rec.t1)}</b></div><div><span>Target 2</span><b class="pos">${money(rec.t2)}</b></div></div></div><div class="trade-metrics"><div class="trade-metric"><span>PCR</span><b>${formatNumber(rec.reading.pcr, 2)}</b></div><div class="trade-metric"><span>OI</span><b>${compact(rec.leg.oi)}</b></div><div class="trade-metric"><span>OI Change</span><b>${formatNumber(rec.leg.changeOI, 0)}</b></div><div class="trade-metric"><span>Volume</span><b>${compact(rec.leg.volume || 0)}</b></div><div class="trade-metric"><span>IV</span><b>${formatNumber(rec.leg.iv, 2)}%</b></div><div class="trade-metric"><span>Delta</span><b>${formatNumber(rec.leg.delta || 0, 3)}</b></div><div class="trade-metric"><span>Gamma</span><b>${formatNumber(rec.leg.gamma || 0, 3)}</b></div><div class="trade-metric"><span>Theta</span><b>${formatNumber(rec.leg.theta || 0, 3)}</b></div><div class="trade-metric"><span>Vega</span><b>${formatNumber(rec.leg.vega || 0, 3)}</b></div><div class="trade-metric"><span>Max Pain</span><b>${rec.atm}</b></div></div><div class="ai-section"><b>Reason</b><ul class="explain-list"><li class="good">✔ ${rec.side > 0 ? 'Bullish PCR / Put support confirmation' : 'Bearish PCR / Call writing confirmation'}</li><li class="good">✔ OI change supports selected direction</li><li class="good">✔ VWAP signal: ${rec.reading.vwapSignal}</li><li class="good">✔ Gamma/IV available from option chain when provider supplies Greeks</li></ul></div></div>`;
}

function marketStrip(state) {
  const get = (sym) => state.snapshot.indices.find((i) => i.symbol === sym);
  const items = [['NIFTY 50', get('NIFTY50')], ['SENSEX', get('SENSEX')], ['BANKNIFTY', get('BANKNIFTY')], ['INDIA VIX', get('INDIAVIX')]].filter(([, v]) => v);
  return `<div class="ai-market-strip">${items.map(([label, i]) => `<div><span>${label}</span><b>${formatNumber(i.value, 2)}</b><em class="${directionClass(i.change)}">${i.change > 0 ? '+' : ''}${formatNumber(i.changePct, 2)}%</em></div>`).join('')}<div class="right">${dataPill(state.snapshot.status)}<span class="pill ${state.snapshot.status === 'LIVE' ? 'live' : 'closed'}">${state.snapshot.status === 'LIVE' ? 'Market Open' : 'Market Closed / Last Data'}</span></div></div>`;
}

export function renderAIRecommendations(state, provider) {
  const filters = [['all', 'All High Confidence'], ['strongBuy', 'Only Strong Buy'], ['buy', 'Only Buy'], ['sell', 'Only Sell'], ['strongSell', 'Only Strong Sell'], ['confidence80', 'Confidence > 80%'], ['confidence90', 'Confidence > 90%'], ['nifty50', 'NIFTY 50'], ['sensex', 'SENSEX'], ['fno', 'F&O'], ['Banking', 'Banking'], ['IT', 'IT'], ['Pharma', 'Pharma'], ['Auto', 'Auto'], ['PSU', 'PSU'], ['Midcap', 'Midcap'], ['Smallcap', 'Smallcap']];
  const intraday = buildIntradayRecommendations(state, provider);
  const buys = intraday.filter((c) => c.side > 0);
  const sells = intraday.filter((c) => c.side < 0);
  const opts = optionRecommendations(state);
  const optBuys = opts.filter((o) => o.side > 0);
  const optSells = opts.filter((o) => o.side < 0);
  const avg = intraday.length ? Math.round(intraday.reduce((a, c) => a + c.confidence, 0) / intraday.length) : 0;
  const filterButtons = filters.map(([id, label]) => `<button class="button ${state.aiFilter === id || (!state.aiFilter && id === 'all') ? 'active' : ''}" data-action="ai-filter" data-filter="${id}">${label}</button>`).join('');
  return `${marketStrip(state)}${pageHeader('🧠 AI Trade Recommendations', `High-probability trades only: minimum 7 of 10 core indicators must agree. Live values come from the active market-data provider; stale/free fallback data is labelled clearly.`, `<div class="toolbar">${dataPill(state.snapshot.status)}<span class="pill info">Auto updates 30–60s logic / 1s price ticks</span></div>`)}
    <div class="grid cols-4 ai-kpi-row"><div class="card pad"><div class="metric-label">Buy Signals</div><div class="metric-value pos">${buys.length}</div></div><div class="card pad"><div class="metric-label">Sell Signals</div><div class="metric-value neg">${sells.length}</div></div><div class="card pad"><div class="metric-label">Options Setups</div><div class="metric-value">${opts.length}</div></div><div class="card pad"><div class="metric-label">Avg Confidence</div><div class="metric-value num">${avg || '—'}${avg ? '%' : ''}</div></div></div>
    <div class="toolbar ai-filter-bar">${filterButtons}</div>
    <div class="ai-four-grid">
      <section class="ai-column"><div class="card-header"><div><h3 class="card-title">Intraday Buy</h3><p class="card-subtitle">Top stocks with at least 7 bullish confirmations.</p></div></div>${buys.length ? buys.map(tradeCard).join('') : '<div class="empty-state">No 7/10 bullish intraday setup right now.</div>'}</section>
      <section class="ai-column"><div class="card-header"><div><h3 class="card-title">Intraday Sell</h3><p class="card-subtitle">Top stocks with at least 7 bearish confirmations.</p></div></div>${sells.length ? sells.map(tradeCard).join('') : '<div class="empty-state">No 7/10 bearish intraday setup right now.</div>'}</section>
      <section class="ai-column"><div class="card-header"><div><h3 class="card-title">Options Buy</h3><p class="card-subtitle">CE/PE buy setups from OI, PCR, VWAP and option chain.</p></div></div>${optBuys.length ? optBuys.map(optionTradeCard).join('') : '<div class="empty-state">No high-confidence option buy setup right now.</div>'}</section>
      <section class="ai-column"><div class="card-header"><div><h3 class="card-title">Options Sell / PE Bias</h3><p class="card-subtitle">Bearish option opportunities when 7+ option confirmations align.</p></div></div>${optSells.length ? optSells.map(optionTradeCard).join('') : '<div class="empty-state">No high-confidence option sell setup right now.</div>'}</section>
    </div>
    <div class="warning-panel" style="margin-top:14px"><b>AI rule:</b> Recommendations are hidden unless at least 7 of 10 core indicators agree. This prevents single-indicator calls. Market analysis is probabilistic and not financial advice.</div>
    ${disclaimer()}`;
}
