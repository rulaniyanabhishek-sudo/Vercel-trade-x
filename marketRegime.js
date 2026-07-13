import { average, clamp, round } from '../core/utils.js';

export function detectMarketRegime(snapshot) {
  if (!snapshot?.stocks?.length) {
    return { trend: 'Sideways', volatility: 'Normal', breadth: 1, score: 0, summary: 'Waiting for data' };
  }
  const pctChanges = snapshot.stocks.map((s) => s.changePct).filter(Number.isFinite);
  const avgChange = average(pctChanges);
  const advances = pctChanges.filter((v) => v > 0.05).length;
  const declines = pctChanges.filter((v) => v < -0.05).length;
  const unchanged = snapshot.stocks.length - advances - declines;
  const adRatio = declines ? advances / declines : advances || 1;
  const relVol = average(snapshot.stocks.map((s) => s.relVolume).filter(Number.isFinite));
  const absMove = average(pctChanges.map(Math.abs));
  const vix = snapshot.indices?.find((i) => i.symbol === 'INDIAVIX')?.value ?? 14;

  let score = avgChange * 26 + (adRatio - 1) * 16;
  score = clamp(score, -100, 100);
  let trend = 'Sideways';
  if (score >= 45) trend = 'Strong Uptrend';
  else if (score >= 16) trend = 'Uptrend';
  else if (score <= -45) trend = 'Strong Downtrend';
  else if (score <= -16) trend = 'Downtrend';

  let volatility = 'Normal';
  const volComposite = vix + absMove * 3.2 + Math.max(0, relVol - 1) * 6;
  if (volComposite >= 28) volatility = 'Extreme';
  else if (volComposite >= 20) volatility = 'High';
  else if (volComposite <= 11) volatility = 'Low';

  const condition = trend.includes('Up') ? (trend.includes('Strong') ? 'Strong Bullish' : 'Bullish')
    : trend.includes('Down') ? (trend.includes('Strong') ? 'Strong Bearish' : 'Bearish')
      : 'Sideways';

  return {
    trend,
    condition,
    volatility,
    breadth: round(adRatio, 2),
    advances,
    declines,
    unchanged,
    score: round(score, 1),
    avgChange: round(avgChange, 2),
    relVol: round(relVol, 2),
    summary: `${condition} breadth with ${volatility.toLowerCase()} volatility`
  };
}

export function regimeAdjustedWeights(baseWeights, regime) {
  const weights = { ...baseWeights };
  if (regime?.trend?.includes('Uptrend') || regime?.trend?.includes('Downtrend')) {
    weights.supertrend *= 1.18;
    weights.macd *= 1.12;
    weights.adx *= 1.18;
    weights.priceTrend *= 1.12;
    weights.bollinger *= 0.85;
    weights.rsi *= 0.92;
  } else if (regime?.trend === 'Sideways') {
    weights.rsi *= 1.18;
    weights.bollinger *= 1.22;
    weights.supportResistance *= 1.16;
    weights.supertrend *= 0.88;
    weights.macd *= 0.92;
  }
  if (['High', 'Extreme'].includes(regime?.volatility)) {
    weights.atr = 8;
    weights.volume *= 1.12;
    weights.supportResistance *= 1.12;
  }
  return weights;
}
