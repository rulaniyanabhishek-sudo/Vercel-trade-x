import { clamp, percentDistance, round } from '../core/utils.js';

function nearestAbove(levels, price) {
  return [...levels].filter((l) => l.price > price).sort((a, b) => a.price - b.price)[0] ?? null;
}

function nearestBelow(levels, price) {
  return [...levels].filter((l) => l.price < price).sort((a, b) => b.price - a.price)[0] ?? null;
}

export function buildRiskPlan({ quote, indicators, side = 'WAIT', minRR = 1.5 }) {
  const price = quote.ltp;
  const atr = Math.max(indicators.atr || price * 0.007, price * 0.002);
  const support = nearestBelow([
    ...indicators.supports,
    { price: indicators.pivots?.s1, strength: 'Normal', source: 'Pivot S1' },
    { price: indicators.pivots?.s2, strength: 'Strong', source: 'Pivot S2' }
  ].filter((x) => Number.isFinite(x.price)), price);
  const resistance = nearestAbove([
    ...indicators.resistances,
    { price: indicators.pivots?.r1, strength: 'Normal', source: 'Pivot R1' },
    { price: indicators.pivots?.r2, strength: 'Strong', source: 'Pivot R2' }
  ].filter((x) => Number.isFinite(x.price)), price);

  const vwap = indicators.vwap || price;
  const stLine = indicators.supertrend || price;
  let entryLow = price;
  let entryHigh = price;
  let conservativeStop = null;
  let standardStop = null;
  let aggressiveStop = null;
  let target1 = null;
  let target2 = null;
  let target3 = null;
  let invalidation = null;
  let rr = 0;
  let risk = atr;
  const notes = [];

  if (side.includes('BUY')) {
    entryLow = Math.min(price, Math.max(vwap, price - 0.25 * atr));
    entryHigh = price + 0.18 * atr;
    const structuralStop = support ? support.price - 0.22 * atr : price - 1.15 * atr;
    const superStop = stLine < price ? stLine - 0.12 * atr : price - 1.05 * atr;
    conservativeStop = Math.min(structuralStop, price - 1.45 * atr);
    standardStop = Math.max(Math.min(structuralStop, superStop), price - 1.35 * atr);
    aggressiveStop = Math.max(standardStop, price - 0.82 * atr);
    risk = Math.max(price - standardStop, atr * 0.35);
    target1 = resistance && resistance.price > price + risk * 0.85 ? resistance.price : price + risk * 1.35;
    target2 = price + risk * 2.05;
    target3 = price + risk * 3.0;
    if (resistance && resistance.price > target1 && resistance.price < target3) target2 = Math.max(target2, resistance.price);
    invalidation = standardStop;
    if (support) notes.push(`Stop anchored below ${support.strength.toLowerCase()} support near ₹${round(support.price, 2)}.`);
    if (resistance) notes.push(`Nearest resistance/reference supply is near ₹${round(resistance.price, 2)}.`);
  } else if (side.includes('SELL')) {
    entryLow = price - 0.18 * atr;
    entryHigh = Math.max(price, Math.min(vwap, price + 0.25 * atr));
    const structuralStop = resistance ? resistance.price + 0.22 * atr : price + 1.15 * atr;
    const superStop = stLine > price ? stLine + 0.12 * atr : price + 1.05 * atr;
    conservativeStop = Math.max(structuralStop, price + 1.45 * atr);
    standardStop = Math.min(Math.max(structuralStop, superStop), price + 1.35 * atr);
    aggressiveStop = Math.min(standardStop, price + 0.82 * atr);
    risk = Math.max(standardStop - price, atr * 0.35);
    target1 = support && support.price < price - risk * 0.85 ? support.price : price - risk * 1.35;
    target2 = price - risk * 2.05;
    target3 = price - risk * 3.0;
    if (support && support.price < target1 && support.price > target3) target2 = Math.min(target2, support.price);
    invalidation = standardStop;
    if (resistance) notes.push(`Stop anchored above ${resistance.strength.toLowerCase()} resistance near ₹${round(resistance.price, 2)}.`);
    if (support) notes.push(`Nearest support/reference demand is near ₹${round(support.price, 2)}.`);
  } else {
    notes.push('No trade plan generated because evidence is neutral or conflicting.');
  }

  if (side.includes('BUY')) rr = (target2 - price) / Math.max(price - standardStop, 0.01);
  else if (side.includes('SELL')) rr = (price - target2) / Math.max(standardStop - price, 0.01);
  else rr = 0;

  const rrOk = rr >= minRR;
  if (!rrOk && side !== 'WAIT' && side !== 'NEUTRAL') notes.push(`Risk/reward ${round(rr, 2)} is below the minimum ${minRR}:1 threshold.`);
  const riskPct = price ? (risk / price) * 100 : 0;
  const riskLevel = riskPct > 2.2 ? 'High' : riskPct > 1.1 ? 'Medium' : 'Controlled';
  const vwapDistance = percentDistance(price, vwap);
  if (Math.abs(vwapDistance) > 2.2) notes.push('Price is extended from VWAP; chasing risk is elevated.');

  return {
    side,
    entryLow: round(entryLow, 2),
    entryHigh: round(entryHigh, 2),
    conservativeStop: conservativeStop ? round(conservativeStop, 2) : null,
    standardStop: standardStop ? round(standardStop, 2) : null,
    aggressiveStop: aggressiveStop ? round(aggressiveStop, 2) : null,
    target1: target1 ? round(target1, 2) : null,
    target2: target2 ? round(target2, 2) : null,
    target3: target3 ? round(target3, 2) : null,
    invalidation: invalidation ? round(invalidation, 2) : null,
    rr: round(clamp(rr, 0, 9.99), 2),
    rrOk,
    riskLevel,
    riskPct: round(riskPct, 2),
    support,
    resistance,
    notes
  };
}
