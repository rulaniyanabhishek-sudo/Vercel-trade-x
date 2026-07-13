import { writeFileSync } from 'node:fs';
import { buildIndicatorSnapshot } from '../src/engines/indicators.js';
import { LIVE_SNAPSHOT } from '../src/data/liveSnapshot.js';

const OUT = new URL('../src/data/niftyOptionSnapshot.js', import.meta.url);
const REPORT = new URL('../nifty-option-table-validation.json', import.meta.url);
const round = (value, digits = 2) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : 0;
const percentDistance = (a, b) => b ? ((a - b) / b) * 100 : 0;

function isIndianMarketSession(now = new Date()) {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60;
}

function optionLeg(rawLeg) {
  const live = rawLeg?.liveData || {};
  const oi = Number(live.oi ?? 0) || 0;
  const prevOI = Number(live.prevOI ?? oi) || 0;
  const changeOI = oi - prevOI;
  return {
    ltp: round(Number(live.ltp ?? 0) || 0, 2),
    oi,
    prevOI,
    changeOI,
    oiPct: prevOI ? round((changeOI / prevOI) * 100, 2) : 0,
    dayChange: round(Number(live.dayChange ?? 0) || 0, 2),
    dayChangePct: round(Number(live.dayChangePerc ?? 0) || 0, 2),
    iv: round(Number(rawLeg?.greeks?.iv ?? 0) || 0, 2),
    token: rawLeg?.token || rawLeg?.growwContractId || '—',
    deltaClass: { ltp: '', oi: '', changeOI: '', oiPct: '' }
  };
}

function signalFromData({ totals, spot, timestamp }) {
  const candles = LIVE_SNAPSHOT.indices?.NIFTY50?.candles || [];
  const indicator = candles.length ? buildIndicatorSnapshot(candles) : { vwap: spot, relVolume: 1, vwapSlope: 0 };
  const vwapValue = indicator.vwap || spot;
  const past = candles[Math.max(0, candles.length - 6)]?.close ?? spot;
  const trendPct = percentDistance(spot, past);
  const trendBull = trendPct > 0.03;
  const trendBear = trendPct < -0.03;
  const volumeOk = (indicator.relVolume || 1) >= 0.75;
  const pcr = totals.totalPutOI / Math.max(1, totals.totalCallOI);
  const diff = totals.totalPutOI - totals.totalCallOI;
  const putWritingLead = totals.totalPutChangeOI > totals.totalCallChangeOI * 1.05;
  const callWritingLead = totals.totalCallChangeOI > totals.totalPutChangeOI * 1.05;
  const priceAboveVwap = spot > vwapValue;
  const priceBelowVwap = spot < vwapValue;
  const bullishVotes = [pcr > 1, diff > 0, putWritingLead, priceAboveVwap, trendBull, volumeOk].filter(Boolean).length;
  const bearishVotes = [pcr < 1, diff < 0, callWritingLead, priceBelowVwap, trendBear, volumeOk].filter(Boolean).length;
  const optionSignal = bullishVotes >= 4 ? 'BUY' : bearishVotes >= 4 ? 'SELL' : 'NEUTRAL';
  const vwapSignal = priceAboveVwap && trendBull && volumeOk ? 'BUY' : priceBelowVwap && trendBear && volumeOk ? 'SELL' : 'NEUTRAL';
  return {
    timestamp,
    time: new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestamp)),
    callOI: totals.totalCallOI,
    putOI: totals.totalPutOI,
    callChangeOI: totals.totalCallChangeOI,
    putChangeOI: totals.totalPutChangeOI,
    pcr: round(pcr, 2),
    diff,
    optionSignal,
    vwap: round(vwapValue, 2),
    currentPrice: round(spot, 2),
    vwapSignal,
    bullishVotes,
    bearishVotes,
    volumeOk,
    trendPct: round(trendPct, 3)
  };
}

async function fetchGrowwPage() {
  const response = await fetch('https://groww.in/options/nifty', {
    headers: { 'User-Agent': 'Mozilla/5.0 TradeX/1.0', Accept: 'text/html,*/*' }
  });
  if (!response.ok) throw new Error(`Groww page HTTP ${response.status}`);
  return response.text();
}

function parseGroww(text) {
  const match = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match) throw new Error('Groww payload not found');
  const jsonText = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  const payload = JSON.parse(jsonText);
  const data = payload?.props?.pageProps?.data;
  const contracts = data?.optionChain?.optionContracts || [];
  if (!contracts.length) throw new Error('No option contracts found');
  const rows = contracts.map((contract) => {
    const strike = Math.round((Number(contract.strikePrice) || 0) / 100);
    return { strike, call: optionLeg(contract.ce), put: optionLeg(contract.pe) };
  }).filter((row) => row.strike > 0).sort((a, b) => a.strike - b.strike);
  const spot = Number(data?.company?.liveData?.ltp) || LIVE_SNAPSHOT.indices?.NIFTY50?.quote?.ltp || 0;
  const timestamp = Date.now();
  const totals = {
    totalCallOI: rows.reduce((acc, row) => acc + row.call.oi, 0),
    totalPutOI: rows.reduce((acc, row) => acc + row.put.oi, 0),
    totalCallChangeOI: rows.reduce((acc, row) => acc + row.call.changeOI, 0),
    totalPutChangeOI: rows.reduce((acc, row) => acc + row.put.changeOI, 0)
  };
  const nearest = rows.reduce((best, row) => Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best, rows[0]);
  const reading = signalFromData({ totals, spot, timestamp });
  return {
    source: 'Embedded latest Groww public NIFTY option-chain payload; frontend tries to refresh it every second',
    status: isIndianMarketSession() ? 'LIVE' : 'MARKET_CLOSED',
    marketOpen: isIndianMarketSession(),
    fetchedAt: timestamp,
    fetchedAtIso: new Date(timestamp).toISOString(),
    underlying: 'NIFTY 50',
    expiryLabel: 'Nearest expiry from Groww page',
    spot: round(spot, 2),
    atmStrike: nearest?.strike || Math.round(spot / 50) * 50,
    rows,
    totals,
    reading,
    validation: { ok: rows.length > 20, rows: rows.length, totalCallOI: totals.totalCallOI, totalPutOI: totals.totalPutOI }
  };
}

const html = await fetchGrowwPage();
const snapshot = parseGroww(html);
writeFileSync(OUT, `// Auto-generated by scripts/fetch_nifty_option_snapshot.mjs\nexport const NIFTY_OPTION_SNAPSHOT = ${JSON.stringify(snapshot)};\n`);
writeFileSync(REPORT, JSON.stringify(snapshot.validation, null, 2));
console.log('Wrote', OUT.pathname, snapshot.validation);
