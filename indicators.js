import { average, clamp, last, percentDistance, round } from '../core/utils.js';

export function sma(values, period) {
  return values.map((_, i) => {
    if (i + 1 < period) return null;
    const slice = values.slice(i + 1 - period, i + 1);
    return average(slice);
  });
}

export function ema(values, period) {
  const k = 2 / (period + 1);
  const out = new Array(values.length).fill(null);
  let prev = null;
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (!Number.isFinite(value)) continue;
    if (prev === null) {
      const start = Math.max(0, i + 1 - period);
      prev = average(values.slice(start, i + 1));
    } else {
      prev = value * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function rsi(closes, period = 14) {
  const out = new Array(closes.length).fill(null);
  if (closes.length < period + 1) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = closes[i] - closes[i - 1];
    gains += Math.max(diff, 0);
    losses += Math.max(-diff, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  out[period] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i += 1) {
    const diff = closes[i] - closes[i - 1];
    avgGain = ((avgGain * (period - 1)) + Math.max(diff, 0)) / period;
    avgLoss = ((avgLoss * (period - 1)) + Math.max(-diff, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - (100 / (1 + avgGain / avgLoss));
  }
  return out;
}

export function macd(closes, fast = 12, slow = 26, signal = 9) {
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = closes.map((_, i) => (fastEma[i] !== null && slowEma[i] !== null ? fastEma[i] - slowEma[i] : null));
  const signalLine = ema(macdLine.map((v) => v ?? 0), signal).map((v, i) => (macdLine[i] === null ? null : v));
  const histogram = macdLine.map((v, i) => (v !== null && signalLine[i] !== null ? v - signalLine[i] : null));
  return { macdLine, signalLine, histogram };
}

export function trueRange(candle, previousClose) {
  if (!candle) return 0;
  if (!Number.isFinite(previousClose)) return candle.high - candle.low;
  return Math.max(
    candle.high - candle.low,
    Math.abs(candle.high - previousClose),
    Math.abs(candle.low - previousClose)
  );
}

export function atr(candles, period = 14) {
  const tr = candles.map((c, i) => trueRange(c, i > 0 ? candles[i - 1].close : c.close));
  return ema(tr, period);
}

export function bollingerBands(closes, period = 20, multiplier = 2) {
  const basis = sma(closes, period);
  const upper = new Array(closes.length).fill(null);
  const lower = new Array(closes.length).fill(null);
  const bandwidth = new Array(closes.length).fill(null);
  for (let i = period - 1; i < closes.length; i += 1) {
    const slice = closes.slice(i + 1 - period, i + 1);
    const mean = basis[i];
    const variance = average(slice.map((v) => (v - mean) ** 2));
    const sd = Math.sqrt(variance);
    upper[i] = mean + multiplier * sd;
    lower[i] = mean - multiplier * sd;
    bandwidth[i] = mean ? ((upper[i] - lower[i]) / mean) * 100 : null;
  }
  return { basis, upper, lower, bandwidth };
}

export function vwap(candles) {
  const out = [];
  let cumulativePV = 0;
  let cumulativeVol = 0;
  for (const c of candles) {
    const typicalPrice = (c.high + c.low + c.close) / 3;
    cumulativePV += typicalPrice * c.volume;
    cumulativeVol += c.volume;
    out.push(cumulativeVol ? cumulativePV / cumulativeVol : c.close);
  }
  return out;
}

export function adx(candles, period = 14) {
  const plusDM = [0];
  const minusDM = [0];
  const tr = [candles[0] ? candles[0].high - candles[0].low : 0];
  for (let i = 1; i < candles.length; i += 1) {
    const upMove = candles[i].high - candles[i - 1].high;
    const downMove = candles[i - 1].low - candles[i].low;
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(trueRange(candles[i], candles[i - 1].close));
  }
  const atrSmoothed = ema(tr, period);
  const plusSmoothed = ema(plusDM, period);
  const minusSmoothed = ema(minusDM, period);
  const plusDI = candles.map((_, i) => (atrSmoothed[i] ? (100 * plusSmoothed[i]) / atrSmoothed[i] : null));
  const minusDI = candles.map((_, i) => (atrSmoothed[i] ? (100 * minusSmoothed[i]) / atrSmoothed[i] : null));
  const dx = candles.map((_, i) => {
    if (plusDI[i] === null || minusDI[i] === null || plusDI[i] + minusDI[i] === 0) return null;
    return (100 * Math.abs(plusDI[i] - minusDI[i])) / (plusDI[i] + minusDI[i]);
  });
  const adxLine = ema(dx.map((v) => v ?? 0), period).map((v, i) => (dx[i] === null ? null : v));
  return { plusDI, minusDI, adxLine };
}

export function stochasticRsi(closes, rsiPeriod = 14, stochPeriod = 14) {
  const rsiLine = rsi(closes, rsiPeriod);
  const k = rsiLine.map((value, i) => {
    if (value === null || i + 1 < stochPeriod) return null;
    const slice = rsiLine.slice(i + 1 - stochPeriod, i + 1).filter(Number.isFinite);
    if (slice.length < stochPeriod) return null;
    const min = Math.min(...slice);
    const max = Math.max(...slice);
    return max === min ? 50 : ((value - min) / (max - min)) * 100;
  });
  const d = sma(k.map((v) => v ?? 0), 3).map((v, i) => (k[i] === null ? null : v));
  return { k, d };
}

export function supertrend(candles, period = 10, multiplier = 3) {
  const atrLine = atr(candles, period);
  const out = new Array(candles.length).fill(null);
  const direction = new Array(candles.length).fill('NEUTRAL');
  let finalUpper = null;
  let finalLower = null;
  let trend = 'BULLISH';
  for (let i = 0; i < candles.length; i += 1) {
    const c = candles[i];
    const a = atrLine[i];
    if (a === null || !Number.isFinite(a)) continue;
    const hl2 = (c.high + c.low) / 2;
    const basicUpper = hl2 + multiplier * a;
    const basicLower = hl2 - multiplier * a;
    if (i === 0 || finalUpper === null || finalLower === null) {
      finalUpper = basicUpper;
      finalLower = basicLower;
    } else {
      const prevClose = candles[i - 1].close;
      finalUpper = basicUpper < finalUpper || prevClose > finalUpper ? basicUpper : finalUpper;
      finalLower = basicLower > finalLower || prevClose < finalLower ? basicLower : finalLower;
      if (trend === 'BEARISH' && c.close > finalUpper) trend = 'BULLISH';
      else if (trend === 'BULLISH' && c.close < finalLower) trend = 'BEARISH';
    }
    out[i] = trend === 'BULLISH' ? finalLower : finalUpper;
    direction[i] = trend;
  }
  return { line: out, direction };
}

export function ichimoku(candles) {
  const conv = new Array(candles.length).fill(null);
  const base = new Array(candles.length).fill(null);
  const spanA = new Array(candles.length).fill(null);
  const spanB = new Array(candles.length).fill(null);
  const chikou = new Array(candles.length).fill(null);
  const mid = (i, p) => {
    if (i + 1 < p) return null;
    const slice = candles.slice(i + 1 - p, i + 1);
    return (Math.max(...slice.map((c) => c.high)) + Math.min(...slice.map((c) => c.low))) / 2;
  };
  for (let i = 0; i < candles.length; i += 1) {
    conv[i] = mid(i, 9);
    base[i] = mid(i, 26);
    if (conv[i] !== null && base[i] !== null) spanA[i] = (conv[i] + base[i]) / 2;
    spanB[i] = mid(i, 52);
    if (i >= 26) chikou[i - 26] = candles[i].close;
  }
  return { conversion: conv, base, spanA, spanB, chikou };
}

export function pivotPoints(previousHigh, previousLow, previousClose) {
  const pivot = (previousHigh + previousLow + previousClose) / 3;
  const r1 = (2 * pivot) - previousLow;
  const s1 = (2 * pivot) - previousHigh;
  const r2 = pivot + (previousHigh - previousLow);
  const s2 = pivot - (previousHigh - previousLow);
  const r3 = previousHigh + 2 * (pivot - previousLow);
  const s3 = previousLow - 2 * (previousHigh - pivot);
  return { pivot, r1, r2, r3, s1, s2, s3 };
}

export function detectSwingLevels(candles, lookback = 3, limit = 8) {
  const supports = [];
  const resistances = [];
  for (let i = lookback; i < candles.length - lookback; i += 1) {
    const lows = candles.slice(i - lookback, i + lookback + 1).map((c) => c.low);
    const highs = candles.slice(i - lookback, i + lookback + 1).map((c) => c.high);
    if (candles[i].low === Math.min(...lows)) supports.push({ price: candles[i].low, touches: 1, source: 'Swing low' });
    if (candles[i].high === Math.max(...highs)) resistances.push({ price: candles[i].high, touches: 1, source: 'Swing high' });
  }
  const merge = (levels) => {
    const sorted = [...levels].sort((a, b) => a.price - b.price);
    const merged = [];
    for (const level of sorted) {
      const lastLevel = merged[merged.length - 1];
      if (lastLevel && Math.abs(percentDistance(level.price, lastLevel.price)) < 0.18) {
        lastLevel.price = (lastLevel.price * lastLevel.touches + level.price) / (lastLevel.touches + 1);
        lastLevel.touches += 1;
        lastLevel.source = `${lastLevel.source}, ${level.source}`;
      } else {
        merged.push({ ...level });
      }
    }
    return merged
      .sort((a, b) => b.touches - a.touches)
      .slice(0, limit)
      .map((l) => ({ ...l, strength: l.touches >= 3 ? 'Strong' : l.touches === 2 ? 'Normal' : 'Weak' }));
  };
  return { supports: merge(supports), resistances: merge(resistances) };
}

export function relativeVolume(candles, period = 20) {
  if (candles.length < 2) return 1;
  const current = candles[candles.length - 1].volume;
  const prior = candles.slice(Math.max(0, candles.length - 1 - period), candles.length - 1).map((c) => c.volume);
  const avg = average(prior);
  return avg ? current / avg : 1;
}

export function slope(values, lookback = 5) {
  const valid = values.filter(Number.isFinite);
  if (valid.length < lookback + 1) return 0;
  const tail = valid.slice(-lookback - 1);
  return (tail[tail.length - 1] - tail[0]) / Math.max(Math.abs(tail[0]), 1) * 100;
}

export function candleAggregation(candles, groupSize = 5) {
  if (groupSize <= 1) return [...candles];
  const out = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (!group.length) continue;
    out.push({
      time: group[0].time,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((acc, c) => acc + c.volume, 0)
    });
  }
  return out;
}

export function buildIndicatorSnapshot(candles) {
  const closes = candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const sma20Line = sma(closes, 20);
  const sma50Line = sma(closes, 50);
  const rsiLine = rsi(closes, 14);
  const macdPack = macd(closes);
  const atrLine = atr(candles, 14);
  const vwapLine = vwap(candles);
  const st = supertrend(candles);
  const bb = bollingerBands(closes);
  const adxPack = adx(candles);
  const stoch = stochasticRsi(closes);
  const ichi = ichimoku(candles);
  const sr = detectSwingLevels(candles);
  const prev = candles[Math.max(0, candles.length - 30)] ?? candles[0];
  const pivots = pivotPoints(prev.high, prev.low, prev.close);
  return {
    close: last(closes, 0),
    ema9: last(ema9),
    ema20: last(ema20),
    ema50: last(ema50),
    sma20: last(sma20Line),
    sma50: last(sma50Line),
    rsi: last(rsiLine),
    rsiSlope: slope(rsiLine, 5),
    macd: last(macdPack.macdLine),
    macdSignal: last(macdPack.signalLine),
    macdHist: last(macdPack.histogram),
    macdHistSlope: slope(macdPack.histogram, 4),
    atr: last(atrLine, 0),
    vwap: last(vwapLine),
    vwapSlope: slope(vwapLine, 7),
    supertrend: last(st.line),
    supertrendDirection: st.direction[st.direction.length - 1] ?? 'NEUTRAL',
    bbUpper: last(bb.upper),
    bbLower: last(bb.lower),
    bbBasis: last(bb.basis),
    bbWidth: last(bb.bandwidth),
    adx: last(adxPack.adxLine),
    plusDI: last(adxPack.plusDI),
    minusDI: last(adxPack.minusDI),
    stochK: last(stoch.k),
    stochD: last(stoch.d),
    ichimokuConversion: last(ichi.conversion),
    ichimokuBase: last(ichi.base),
    ichimokuSpanA: last(ichi.spanA),
    ichimokuSpanB: last(ichi.spanB),
    supports: sr.supports,
    resistances: sr.resistances,
    pivots,
    relVolume: relativeVolume(candles),
    raw: { ema9, ema20, ema50, sma20Line, rsiLine, macdPack, atrLine, vwapLine, supertrend: st, bb, adxPack, stoch, ichi }
  };
}

export function classifyDistanceFromVwap(price, vwapValue, atrValue) {
  const distancePct = percentDistance(price, vwapValue);
  const atrPct = atrValue && price ? (atrValue / price) * 100 : 0;
  const minThreshold = Math.max(0.08, atrPct * 0.18);
  if (Math.abs(distancePct) < minThreshold) return { state: 'TOUCHING', distancePct, minThreshold };
  if (distancePct > 0) return { state: 'ABOVE', distancePct, minThreshold };
  return { state: 'BELOW', distancePct, minThreshold };
}

export function indicatorValueText(name, value) {
  if (!Number.isFinite(value)) return '—';
  if (['RSI', 'ADX', 'Stoch RSI'].includes(name)) return round(value, 1).toString();
  return round(value, 2).toString();
}

export function latestCandle(candles) {
  return candles[candles.length - 1];
}

export function previousCandle(candles) {
  return candles[candles.length - 2] ?? candles[candles.length - 1];
}

export function boundedScore(score) {
  return clamp(score, -1, 1);
}
