import { buildIndicatorSnapshot, classifyDistanceFromVwap, boundedScore } from './indicators.js';
import { buildRiskPlan } from './riskEngine.js';
import { regimeAdjustedWeights } from './marketRegime.js';
import { clamp, percentDistance, round } from '../core/utils.js';

export const BASE_WEIGHTS = {
  priceTrend: 15,
  vwap: 15,
  macd: 10,
  rsi: 8,
  supertrend: 12,
  ichimoku: 10,
  bollinger: 5,
  adx: 8,
  volume: 10,
  supportResistance: 7
};

function scoreToSignal(score) {
  if (score >= 70) return 'STRONG BUY';
  if (score >= 40) return 'BUY';
  if (score >= 15) return 'WEAK BUY';
  if (score <= -70) return 'STRONG SELL';
  if (score <= -40) return 'SELL';
  if (score <= -15) return 'WEAK SELL';
  return 'WAIT';
}

function directionOfSignal(signal) {
  if (signal.includes('BUY')) return 'BUY';
  if (signal.includes('SELL')) return 'SELL';
  return 'WAIT';
}

function evidencePush(item, evidence, conflicts) {
  if (item.score > 0.28) evidence.push(item.explanation);
  if (item.score < -0.28) conflicts.push(item.explanation);
}

function makeItem(name, value, signal, score, weight, explanation) {
  return { name, value, signal, score: boundedScore(score), weight, explanation };
}

export function analyzeStock({ quote, candles, marketRegime, dataStatus = 'DEMO', timeframe = '5m' }) {
  const indicators = buildIndicatorSnapshot(candles);
  if (Number.isFinite(quote.relVolume) && quote.relVolume > 0) indicators.relVolume = quote.relVolume;
  const price = quote.ltp;
  const weights = regimeAdjustedWeights(BASE_WEIGHTS, marketRegime ?? {});
  const items = [];
  const evidence = [];
  const conflicts = [];
  const warnings = [];

  const emaBull = price > indicators.ema20 && indicators.ema20 > indicators.ema50;
  const emaBear = price < indicators.ema20 && indicators.ema20 < indicators.ema50;
  const priceSlope = percentDistance(price, candles[Math.max(0, candles.length - 8)]?.close ?? price);
  items.push(makeItem(
    'Price trend',
    `${round(priceSlope, 2)}%`,
    emaBull ? 'BUY' : emaBear ? 'SELL' : 'NEUTRAL',
    emaBull ? 0.82 : emaBear ? -0.82 : clamp(priceSlope / 1.2, -0.35, 0.35),
    weights.priceTrend,
    emaBull ? 'Price is above rising short/medium EMAs.' : emaBear ? 'Price is below falling short/medium EMAs.' : 'Price trend is mixed around moving averages.'
  ));

  const vwapState = classifyDistanceFromVwap(price, indicators.vwap, indicators.atr);
  const vwapBull = vwapState.state === 'ABOVE' && indicators.vwapSlope > 0.01 && indicators.relVolume >= 0.85;
  const vwapBear = vwapState.state === 'BELOW' && indicators.vwapSlope < -0.01 && indicators.relVolume >= 0.85;
  let vwapScore = 0;
  if (vwapBull) vwapScore = clamp(0.55 + Math.min(0.35, Math.abs(vwapState.distancePct) / 2), 0, 0.92);
  else if (vwapBear) vwapScore = -clamp(0.55 + Math.min(0.35, Math.abs(vwapState.distancePct) / 2), 0, 0.92);
  else if (vwapState.state !== 'TOUCHING') vwapScore = vwapState.state === 'ABOVE' ? 0.20 : -0.20;
  items.push(makeItem(
    'VWAP',
    round(indicators.vwap, 2),
    vwapBull ? 'BUY' : vwapBear ? 'SELL' : 'NEUTRAL',
    vwapScore,
    weights.vwap,
    vwapBull ? 'Price is above a rising VWAP with acceptable volume.' : vwapBear ? 'Price is below a falling VWAP with acceptable volume.' : 'VWAP confirmation is weak; price is near VWAP or slope/volume is insufficient.'
  ));

  const macdBull = indicators.macd > indicators.macdSignal && indicators.macdHist > 0 && indicators.macdHistSlope >= 0;
  const macdBear = indicators.macd < indicators.macdSignal && indicators.macdHist < 0 && indicators.macdHistSlope <= 0;
  items.push(makeItem(
    'MACD',
    round(indicators.macdHist, 2),
    macdBull ? 'BUY' : macdBear ? 'SELL' : 'NEUTRAL',
    macdBull ? 0.72 : macdBear ? -0.72 : clamp((indicators.macdHist || 0) / Math.max(indicators.atr * 0.12, 0.01), -0.25, 0.25),
    weights.macd,
    macdBull ? 'MACD line is above signal line and histogram momentum is positive.' : macdBear ? 'MACD line is below signal line and histogram momentum is negative.' : 'MACD has not confirmed a clean momentum direction.'
  ));

  let rsiScore = 0;
  let rsiSignal = 'NEUTRAL';
  let rsiExplanation = 'RSI is neutral; no automatic overbought/oversold trade is assumed.';
  if (indicators.rsi >= 52 && indicators.rsi <= 68 && indicators.rsiSlope > 0 && emaBull) {
    rsiScore = 0.68; rsiSignal = 'BUY'; rsiExplanation = 'RSI is positive but not overextended, confirming the uptrend.';
  } else if (indicators.rsi <= 48 && indicators.rsi >= 32 && indicators.rsiSlope < 0 && emaBear) {
    rsiScore = -0.68; rsiSignal = 'SELL'; rsiExplanation = 'RSI is weak and falling in a downtrend.';
  } else if (indicators.rsi > 74) {
    rsiScore = emaBull ? -0.18 : -0.45; rsiSignal = 'CAUTION'; rsiExplanation = 'RSI is overextended; reversal/chasing risk should be checked.';
  } else if (indicators.rsi < 26) {
    rsiScore = emaBear ? 0.18 : 0.45; rsiSignal = 'CAUTION'; rsiExplanation = 'RSI is deeply oversold; short trades carry bounce risk.';
  }
  items.push(makeItem('RSI', round(indicators.rsi, 1), rsiSignal, rsiScore, weights.rsi, rsiExplanation));

  items.push(makeItem(
    'Supertrend',
    round(indicators.supertrend, 2),
    indicators.supertrendDirection === 'BULLISH' ? 'BUY' : indicators.supertrendDirection === 'BEARISH' ? 'SELL' : 'NEUTRAL',
    indicators.supertrendDirection === 'BULLISH' ? 0.75 : indicators.supertrendDirection === 'BEARISH' ? -0.75 : 0,
    weights.supertrend,
    indicators.supertrendDirection === 'BULLISH' ? 'Supertrend remains bullish; trailing support is active.' : indicators.supertrendDirection === 'BEARISH' ? 'Supertrend remains bearish; trailing resistance is active.' : 'Supertrend is not decisive.'
  ));

  const cloudTop = Math.max(indicators.ichimokuSpanA || price, indicators.ichimokuSpanB || price);
  const cloudBottom = Math.min(indicators.ichimokuSpanA || price, indicators.ichimokuSpanB || price);
  const ichiBull = price > cloudTop && indicators.ichimokuConversion > indicators.ichimokuBase;
  const ichiBear = price < cloudBottom && indicators.ichimokuConversion < indicators.ichimokuBase;
  items.push(makeItem(
    'Ichimoku',
    `${round(cloudBottom, 2)}-${round(cloudTop, 2)}`,
    ichiBull ? 'BUY' : ichiBear ? 'SELL' : 'NEUTRAL',
    ichiBull ? 0.65 : ichiBear ? -0.65 : 0,
    weights.ichimoku,
    ichiBull ? 'Price is above cloud with Tenkan/Kijun bullish alignment.' : ichiBear ? 'Price is below cloud with Tenkan/Kijun bearish alignment.' : 'Price is inside/near cloud or cloud confirmation is mixed.'
  ));

  const bbPos = indicators.bbUpper && indicators.bbLower ? (price - indicators.bbLower) / (indicators.bbUpper - indicators.bbLower) : 0.5;
  const bbSqueeze = indicators.bbWidth < 1.2;
  const bbBull = bbPos > 0.58 && price > indicators.bbBasis && !bbSqueeze;
  const bbBear = bbPos < 0.42 && price < indicators.bbBasis && !bbSqueeze;
  items.push(makeItem(
    'Bollinger Bands',
    `pos ${round(bbPos * 100, 0)}%`,
    bbBull ? 'BUY' : bbBear ? 'SELL' : bbSqueeze ? 'WAIT' : 'NEUTRAL',
    bbBull ? 0.42 : bbBear ? -0.42 : bbSqueeze ? 0 : 0,
    weights.bollinger,
    bbBull ? 'Price is holding the upper half of expanding bands.' : bbBear ? 'Price is holding the lower half of expanding bands.' : bbSqueeze ? 'Bollinger squeeze indicates compression; wait for breakout confirmation.' : 'Bollinger Bands do not add a strong edge.'
  ));

  const adxTrend = indicators.adx >= 22;
  const adxScore = adxTrend ? (indicators.plusDI > indicators.minusDI ? 0.48 : -0.48) : 0;
  items.push(makeItem(
    'ADX',
    round(indicators.adx, 1),
    adxTrend ? (indicators.plusDI > indicators.minusDI ? 'BUY' : 'SELL') : 'WAIT',
    adxScore,
    weights.adx,
    adxTrend ? `ADX confirms a tradeable trend; ${indicators.plusDI > indicators.minusDI ? '+DI leads -DI.' : '-DI leads +DI.'}` : 'ADX is low; trend strength may be insufficient.'
  ));

  const volumeScore = indicators.relVolume >= 1.45 ? (priceSlope >= 0 ? 0.55 : -0.55) : indicators.relVolume >= 1.05 ? (priceSlope >= 0 ? 0.25 : -0.25) : -0.12;
  items.push(makeItem(
    'Volume',
    `${round(indicators.relVolume, 2)}x`,
    indicators.relVolume >= 1.05 ? (priceSlope >= 0 ? 'BUY' : 'SELL') : 'WEAK',
    volumeScore,
    weights.volume,
    indicators.relVolume >= 1.45 ? 'Relative volume is strong and confirms the current price impulse.' : indicators.relVolume >= 1.05 ? 'Relative volume is acceptable but not exceptional.' : 'Volume confirmation is weak.'
  ));

  const nearestSupport = indicators.supports.filter((s) => s.price < price).sort((a, b) => b.price - a.price)[0];
  const nearestResistance = indicators.resistances.filter((r) => r.price > price).sort((a, b) => a.price - b.price)[0];
  const distSupport = nearestSupport ? Math.abs(percentDistance(price, nearestSupport.price)) : 9;
  const distResistance = nearestResistance ? Math.abs(percentDistance(nearestResistance.price, price)) : 9;
  let srScore = 0;
  let srSignal = 'NEUTRAL';
  let srExplanation = 'No nearby major support/resistance conflict detected.';
  if (distResistance < 0.45 && priceSlope > 0) {
    srScore = -0.45; srSignal = 'CAUTION'; srExplanation = 'Price is approaching nearby resistance; breakout confirmation is required.';
  } else if (distSupport < 0.45 && priceSlope < 0) {
    srScore = 0.45; srSignal = 'CAUTION'; srExplanation = 'Price is approaching nearby support; breakdown confirmation is required.';
  } else if (nearestSupport && price > nearestSupport.price && distSupport < 1.4) {
    srScore = 0.28; srSignal = 'BUY'; srExplanation = 'Price is trading above a nearby support zone.';
  } else if (nearestResistance && price < nearestResistance.price && distResistance < 1.4) {
    srScore = -0.28; srSignal = 'SELL'; srExplanation = 'Price is trading below a nearby resistance/supply zone.';
  }
  items.push(makeItem('Support/resistance', nearestSupport ? round(nearestSupport.price, 2) : '—', srSignal, srScore, weights.supportResistance, srExplanation));

  items.forEach((item) => evidencePush(item, evidence, conflicts));
  const totalWeight = items.reduce((acc, i) => acc + i.weight, 0);
  let score = items.reduce((acc, i) => acc + i.score * i.weight, 0) / totalWeight * 100;

  if (marketRegime?.volatility === 'Extreme') {
    score *= 0.82;
    warnings.push('Extreme volatility regime: confidence reduced and stops may widen.');
  }
  if (dataStatus === 'STALE') {
    score *= 0.45;
    warnings.push('Data is stale; high-confidence signals are disabled.');
  }
  const rawSignal = scoreToSignal(score);
  const side = directionOfSignal(rawSignal);
  const riskPlan = buildRiskPlan({ quote, indicators, side: rawSignal, minRR: 1.5 });

  let signal = rawSignal;
  if (['STRONG BUY', 'BUY', 'STRONG SELL', 'SELL'].includes(signal) && !riskPlan.rrOk) {
    signal = 'NO TRADE';
  }
  const strongAgreement = items.filter((i) => Math.sign(i.score) === Math.sign(score) && Math.abs(i.score) > 0.42).length;
  const strongConflict = items.filter((i) => Math.sign(i.score) !== Math.sign(score) && Math.abs(i.score) > 0.35).length;
  if (strongConflict >= 4 && Math.abs(score) < 70) {
    signal = 'WAIT';
    warnings.push('Independent indicators are conflicting; wait for confirmation.');
  }
  if (indicators.relVolume < 0.62 && ['BUY', 'SELL', 'STRONG BUY', 'STRONG SELL'].includes(signal)) {
    signal = 'NO TRADE';
    warnings.push('Volume is insufficient for a quality signal.');
  }
  if (Math.abs(percentDistance(price, indicators.vwap)) > 3 && ['STRONG BUY', 'BUY', 'STRONG SELL', 'SELL'].includes(signal)) {
    signal = 'WAIT';
    warnings.push('Move is extended from VWAP; avoid chasing.');
  }

  const agreementRatio = strongAgreement / Math.max(1, strongAgreement + strongConflict);
  let confidence = Math.abs(score) * 0.72 + agreementRatio * 24 + Math.min(10, Math.max(0, indicators.relVolume - 1) * 10);
  if (signal === 'WAIT' || signal === 'NO TRADE') confidence = Math.min(confidence, 54);
  if (dataStatus !== 'LIVE') confidence = Math.min(confidence, 82);
  confidence = round(clamp(confidence, 18, 94), 0);

  const qualityChecks = [
    { label: 'Data freshness', state: dataStatus === 'STALE' ? 'bad' : 'ok', text: dataStatus === 'STALE' ? 'Stale' : dataStatus },
    { label: 'Volume', state: indicators.relVolume >= 1 ? 'ok' : indicators.relVolume >= 0.7 ? 'warn' : 'bad', text: `${round(indicators.relVolume, 2)}x` },
    { label: 'Risk/reward', state: riskPlan.rrOk || side === 'WAIT' ? 'ok' : 'warn', text: `${riskPlan.rr}:1` },
    { label: 'Indicator conflict', state: strongConflict >= 4 ? 'bad' : strongConflict >= 2 ? 'warn' : 'ok', text: `${strongConflict} conflicts` },
    { label: 'VWAP extension', state: Math.abs(percentDistance(price, indicators.vwap)) > 3 ? 'warn' : 'ok', text: `${round(percentDistance(price, indicators.vwap), 2)}%` }
  ];

  const trend = emaBull ? 'Bullish' : emaBear ? 'Bearish' : 'Sideways / mixed';
  const timeframeLabel = timeframe;
  const why = buildWhy(signal, evidence, conflicts, warnings, riskPlan);

  return {
    symbol: quote.symbol,
    name: quote.name,
    quote,
    indicators,
    items,
    score: round(score, 1),
    signal,
    rawSignal,
    confidence,
    trend,
    evidence: evidence.slice(0, 7),
    conflicts: conflicts.slice(0, 7),
    warnings,
    riskPlan,
    qualityChecks,
    riskLevel: riskPlan.riskLevel,
    timeframe: timeframeLabel,
    timestamp: quote.timestamp,
    invalidation: riskPlan.invalidation,
    why
  };
}

function buildWhy(signal, evidence, conflicts, warnings, riskPlan) {
  const parts = [];
  if (signal === 'NO TRADE') {
    parts.push('The engine rejected the trade because the setup did not pass quality controls.');
  } else if (signal === 'WAIT') {
    parts.push('The system is waiting because the evidence is mixed or lacks confirmation.');
  } else {
    parts.push(`The engine generated ${signal} because several independent indicators aligned.`);
  }
  if (evidence.length) parts.push(`Supporting evidence: ${evidence.slice(0, 3).join(' ')}`);
  if (conflicts.length) parts.push(`Conflicting evidence: ${conflicts.slice(0, 2).join(' ')}`);
  if (warnings.length) parts.push(`Risk warning: ${warnings.slice(0, 2).join(' ')}`);
  if (riskPlan?.invalidation) parts.push(`The setup is invalidated near ₹${riskPlan.invalidation}.`);
  return parts.join(' ');
}

export function analyzeUniverse({ snapshot, getCandles, marketRegime, timeframe = '5m' }) {
  return snapshot.stocks.map((quote) => analyzeStock({
    quote,
    candles: getCandles(quote.symbol, timeframe),
    marketRegime,
    dataStatus: snapshot.status,
    timeframe
  }));
}
