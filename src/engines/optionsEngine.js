import { PCR_THRESHOLDS } from '../data/universe.js';
import { buildIndicatorSnapshot } from './indicators.js';
import { average, clamp, formatTime, hashString, normalish, percentDistance, round, seededRandom, sum } from '../core/utils.js';

function optionSignalFromScore(score, conflict = false) {
  if (conflict && Math.abs(score) < 72) return 'WAIT FOR CONFIRMATION';
  if (score >= 78) return 'STRONG BUY';
  if (score >= 48) return 'BUY';
  if (score >= 20) return 'WEAK BUY';
  if (score <= -78) return 'STRONG SELL';
  if (score <= -48) return 'SELL';
  if (score <= -20) return 'WEAK SELL';
  return 'NEUTRAL';
}

export function getOptionConfig(instrument, spot = 0) {
  if (instrument === 'BANKNIFTY') return { label: 'BANK NIFTY', type: 'INDEX', step: 100, lotSize: 15, thresholds: PCR_THRESHOLDS.BANKNIFTY, ivBase: 17.5, expiryFactor: 0.72, oiScale: 1 };
  if (String(instrument).startsWith('STOCK:')) {
    const symbol = String(instrument).split(':')[1];
    const step = spot >= 5000 ? 100 : spot >= 1500 ? 50 : spot >= 500 ? 20 : spot >= 100 ? 5 : 1;
    return { label: `${symbol} Stock Options`, symbol, type: 'STOCK', step, lotSize: 1, thresholds: PCR_THRESHOLDS.STOCK, ivBase: 26, expiryFactor: 0.95, oiScale: 0.18 };
  }
  return { label: 'NIFTY 50', type: 'INDEX', step: 50, lotSize: 25, thresholds: PCR_THRESHOLDS.NIFTY, ivBase: 13.8, expiryFactor: 0.62, oiScale: 1 };
}

export function generateOptionsChain({ instrument = 'NIFTY', spot, timestamp, trendBias = 0 }) {
  const config = getOptionConfig(instrument, spot);
  const step = config.step;
  const atm = Math.round(spot / step) * step;
  const seedBucket = Math.floor(timestamp / 60000);
  const rows = [];
  for (let offset = -8; offset <= 8; offset += 1) {
    const strike = atm + offset * step;
    const distance = Math.abs(strike - spot) / step;
    const rand = seededRandom(hashString(`${instrument}-${strike}-${seedBucket}`));
    const distanceDamp = Math.exp(-distance / 5.2);
    const resistanceBias = strike >= atm ? 1.26 + distance * 0.08 : 0.72;
    const supportBias = strike <= atm ? 1.30 + distance * 0.08 : 0.74;
    const callOI = Math.round((540000 + 2400000 * distanceDamp * resistanceBias) * (0.84 + rand() * 0.38) * config.oiScale);
    const putOI = Math.round((520000 + 2500000 * distanceDamp * supportBias) * (0.84 + rand() * 0.42) * config.oiScale);
    const callChangeSign = trendBias < -0.08 ? 1.25 : trendBias > 0.08 ? -0.35 : 0.32;
    const putChangeSign = trendBias > 0.08 ? 1.25 : trendBias < -0.08 ? -0.35 : 0.32;
    const callChg = Math.round(callOI * (0.015 + rand() * 0.105) * (callChangeSign + normalish(rand) * 0.36));
    const putChg = Math.round(putOI * (0.015 + rand() * 0.105) * (putChangeSign + normalish(rand) * 0.36));
    const callVolume = Math.round((callOI * (0.025 + rand() * 0.16)) / 10) * 10;
    const putVolume = Math.round((putOI * (0.025 + rand() * 0.16)) / 10) * 10;
    const iv = round(config.ivBase + distance * 0.62 + normalish(rand) * 1.2, 2);
    const minPremium = config.type === 'STOCK' ? Math.max(0.5, step * 0.04) : 1.5;
    const callLtp = round(Math.max(minPremium, Math.max(spot - strike, 0) + step * config.expiryFactor * Math.exp(-distance / 2.4) * (0.78 + rand() * 0.46)), 2);
    const putLtp = round(Math.max(minPremium, Math.max(strike - spot, 0) + step * config.expiryFactor * Math.exp(-distance / 2.4) * (0.78 + rand() * 0.46)), 2);
    rows.push({
      strike,
      call: { ltp: callLtp, oi: callOI, changeOI: callChg, oiPctChange: round(callChg / Math.max(1, callOI - callChg) * 100, 2), volume: callVolume, iv },
      put: { ltp: putLtp, oi: putOI, changeOI: putChg, oiPctChange: round(putChg / Math.max(1, putOI - putChg) * 100, 2), volume: putVolume, iv: round(iv + normalish(rand) * 0.35, 2) },
      isATM: strike === atm
    });
  }
  return { instrument, config, spot, atm, timestamp, rows };
}

export function interpretPCR({ pcr, pcrChange, priceVsVwap, vwapSlope, thresholds, callWriting, putWriting, callUnwinding, putUnwinding }) {
  let zone = 'Balanced';
  let absoluteScore = 0;
  const notes = [];
  if (pcr < thresholds.veryLow) {
    zone = 'Very low';
    absoluteScore = -0.72;
    notes.push('Very low PCR indicates bearish positioning, but it may also be oversold in extremes.');
  } else if (pcr < thresholds.low) {
    zone = 'Low';
    absoluteScore = -0.44;
    notes.push('PCR is below its balanced zone, so options positioning leans bearish.');
  } else if (pcr <= thresholds.balancedHigh) {
    zone = 'Balanced';
    absoluteScore = 0.05;
    notes.push('PCR is balanced; direction must come from price/VWAP and OI change.');
  } else if (pcr <= thresholds.high) {
    zone = 'High';
    absoluteScore = 0.48;
    notes.push('PCR is high, usually supportive if price and put writing confirm.');
  } else {
    zone = 'Extreme high';
    absoluteScore = 0.18;
    notes.push('PCR is extremely high; do not automatically buy because contrarian reversal risk is elevated.');
  }

  const pcrTrendScore = clamp(pcrChange / 0.10, -1, 1) * 0.42;
  const vwapScore = priceVsVwap > 0.08 && vwapSlope > 0 ? 0.52 : priceVsVwap < -0.08 && vwapSlope < 0 ? -0.52 : priceVsVwap > 0 ? 0.14 : priceVsVwap < 0 ? -0.14 : 0;
  const writingDelta = (putWriting - callWriting) / Math.max(1, putWriting + callWriting);
  const unwindingDelta = (callUnwinding - putUnwinding) / Math.max(1, callUnwinding + putUnwinding);
  const writingScore = clamp(writingDelta * 1.15 + unwindingDelta * 0.38, -1, 1) * 0.55;

  if (pcrChange > 0.04) notes.push('PCR is rising versus previous reading.');
  else if (pcrChange < -0.04) notes.push('PCR is falling versus previous reading.');
  if (putWriting > callWriting * 1.2) notes.push('Put writing is stronger than call writing.');
  if (callWriting > putWriting * 1.2) notes.push('Call writing is stronger than put writing.');

  const conflict = (absoluteScore > 0.25 && priceVsVwap < -0.08) || (absoluteScore < -0.25 && priceVsVwap > 0.08) || (pcr > thresholds.high && pcrChange < -0.03);
  if (conflict) notes.push('Conflict warning: PCR positioning and price/VWAP confirmation are not aligned.');

  const score = (absoluteScore * 34 + pcrTrendScore * 24 + vwapScore * 24 + writingScore * 28) / 1.1;
  return {
    zone,
    score: round(clamp(score, -100, 100), 1),
    pcrTrendScore: round(pcrTrendScore * 100, 1),
    vwapScore: round(vwapScore * 100, 1),
    writingScore: round(writingScore * 100, 1),
    notes,
    conflict
  };
}

export function analyzeOptions({ instrument = 'NIFTY', spotQuote, spotCandles, history = [] }) {
  const spot = spotQuote.value ?? spotQuote.ltp;
  const prevSpot = spotCandles[Math.max(0, spotCandles.length - 8)]?.close ?? spot;
  const trendBias = percentDistance(spot, prevSpot);
  const chain = generateOptionsChain({ instrument, spot, timestamp: spotQuote.timestamp, trendBias });
  const rows = chain.rows;
  const totalCallOI = sum(rows.map((r) => r.call.oi));
  const totalPutOI = sum(rows.map((r) => r.put.oi));
  const totalCallVol = sum(rows.map((r) => r.call.volume));
  const totalPutVol = sum(rows.map((r) => r.put.volume));
  const callChgPositive = sum(rows.map((r) => Math.max(0, r.call.changeOI)));
  const putChgPositive = sum(rows.map((r) => Math.max(0, r.put.changeOI)));
  const callUnwinding = sum(rows.map((r) => Math.max(0, -r.call.changeOI)));
  const putUnwinding = sum(rows.map((r) => Math.max(0, -r.put.changeOI)));
  const pcr = totalPutOI / Math.max(1, totalCallOI);
  const volumePCR = totalPutVol / Math.max(1, totalCallVol);
  const chgOIPCR = putChgPositive / Math.max(1, callChgPositive);
  const previousPCR = history[history.length - 1]?.pcr ?? pcr - trendBias / 14;
  const pcrChange = pcr - previousPCR;
  const pcrMA = average([...history.slice(-9).map((h) => h.pcr), pcr]);
  const indicator = buildIndicatorSnapshot(spotCandles);
  const spotVwap = indicator.vwap;
  const priceVsVwap = percentDistance(spot, spotVwap);
  const pcrTrend = pcrChange > 0.025 ? 'Rising' : pcrChange < -0.025 ? 'Falling' : 'Flat';
  const thresholds = chain.config.thresholds;

  const maxCallOI = rows.reduce((a, b) => (b.call.oi > a.call.oi ? b : a), rows[0]);
  const maxPutOI = rows.reduce((a, b) => (b.put.oi > a.put.oi ? b : a), rows[0]);
  const maxCallWriting = rows.reduce((a, b) => (b.call.changeOI > a.call.changeOI ? b : a), rows[0]);
  const maxPutWriting = rows.reduce((a, b) => (b.put.changeOI > a.put.changeOI ? b : a), rows[0]);

  const interpretation = interpretPCR({
    pcr,
    pcrChange,
    priceVsVwap,
    vwapSlope: indicator.vwapSlope,
    thresholds,
    callWriting: callChgPositive,
    putWriting: putChgPositive,
    callUnwinding,
    putUnwinding
  });
  const optionSignal = optionSignalFromScore(interpretation.score, interpretation.conflict);
  const vwapSignal = priceVsVwap > 0.10 && indicator.vwapSlope > 0 ? 'BUY' : priceVsVwap < -0.10 && indicator.vwapSlope < 0 ? 'SELL' : 'WAIT';
  const optionBull = optionSignal.includes('BUY');
  const optionBear = optionSignal.includes('SELL');
  const vwapBull = vwapSignal === 'BUY';
  const vwapBear = vwapSignal === 'SELL';
  const combinedConflict = (optionBull && vwapBear) || (optionBear && vwapBull) || interpretation.conflict;
  let combinedScore = interpretation.score;
  combinedScore += vwapBull ? 18 : vwapBear ? -18 : 0;
  combinedScore += pcrTrend === 'Rising' ? 6 : pcrTrend === 'Falling' ? -6 : 0;
  combinedScore = clamp(combinedScore, -100, 100);
  const combinedSignal = optionSignalFromScore(combinedScore, combinedConflict);
  const confidence = round(clamp(Math.abs(combinedScore) * 0.72 + (combinedConflict ? 8 : 22), 18, 92), 0);
  const explanation = [
    `PCR ${round(pcr, 2)} is in the ${interpretation.zone.toLowerCase()} zone and is ${pcrTrend.toLowerCase()}.`,
    `Spot is ${round(priceVsVwap, 2)}% ${priceVsVwap >= 0 ? 'above' : 'below'} VWAP.`,
    putChgPositive > callChgPositive ? 'Put writing leads call writing.' : callChgPositive > putChgPositive ? 'Call writing leads put writing.' : 'Call/put writing is balanced.',
    combinedConflict ? 'Because the evidence conflicts, the engine prefers confirmation over forcing a trade.' : 'Options positioning and VWAP are broadly aligned.'
  ].join(' ');

  const reading = {
    time: formatTime(spotQuote.timestamp),
    timestamp: spotQuote.timestamp,
    totalCallOI,
    totalPutOI,
    diff: totalPutOI - totalCallOI,
    pcr: round(pcr, 2),
    pcrChange: round(pcrChange, 3),
    pcrTrend,
    optionSignal,
    vwap: round(spotVwap, 2),
    spotPrice: round(spot, 2),
    priceVsVwap: round(priceVsVwap, 2),
    vwapSignal,
    combinedSignal,
    confidence,
    explanation
  };

  return {
    instrument,
    config: chain.config,
    chain,
    totals: {
      totalCallOI,
      totalPutOI,
      totalCallVol,
      totalPutVol,
      callWriting: callChgPositive,
      putWriting: putChgPositive,
      callUnwinding,
      putUnwinding,
      pcr: round(pcr, 2),
      volumePCR: round(volumePCR, 2),
      chgOIPCR: round(chgOIPCR, 2),
      previousPCR: round(previousPCR, 2),
      pcrChange: round(pcrChange, 3),
      pcrTrend,
      pcrMA: round(pcrMA, 2),
      pcrZone: interpretation.zone,
      priceVsVwap: round(priceVsVwap, 2),
      vwap: round(spotVwap, 2),
      vwapSlope: round(indicator.vwapSlope, 3),
      spot: round(spot, 2)
    },
    highlights: {
      atm: chain.atm,
      highestCallOI: maxCallOI.strike,
      highestPutOI: maxPutOI.strike,
      maxCallWriting: maxCallWriting.strike,
      maxPutWriting: maxPutWriting.strike,
      majorResistance: maxCallOI.strike,
      majorSupport: maxPutOI.strike
    },
    interpretation,
    reading,
    signal: { optionSignal, vwapSignal, combinedSignal, confidence, combinedScore: round(combinedScore, 1), explanation }
  };
}
