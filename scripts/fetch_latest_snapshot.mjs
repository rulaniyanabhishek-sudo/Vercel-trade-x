import { STOCK_UNIVERSE } from '../src/data/universe.js';
import { writeFileSync } from 'node:fs';

const OUT = new URL('../src/data/liveSnapshot.js', import.meta.url);
const REPORT = new URL('../live-price-validation-report.json', import.meta.url);
const INDEX_MAP = [
  { symbol: 'NIFTY50', label: 'NIFTY 50', yahoo: '^NSEI' },
  { symbol: 'SENSEX', label: 'SENSEX', yahoo: '^BSESN' },
  { symbol: 'BANKNIFTY', label: 'NIFTY BANK', yahoo: '^NSEBANK' },
  { symbol: 'INDIAVIX', label: 'India VIX', yahoo: '^INDIAVIX' }
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (v, d = 2) => Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null;

function yahooSymbol(symbol) {
  return `${symbol}.NS`;
}

async function fetchYahooChart(symbol, range = '1d', interval = '1m') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 TradeX/1.0',
      'Accept': 'application/json,text/plain,*/*'
    }
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data?.chart?.error) throw new Error(data.chart.error.description || 'Yahoo chart error');
  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error('Missing chart meta');
  const meta = result.meta;
  const q = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const candles = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = q.open?.[i], high = q.high?.[i], low = q.low?.[i], close = q.close?.[i], volume = q.volume?.[i];
    if ([open, high, low, close].every(Number.isFinite)) {
      candles.push({
        time: timestamps[i] * 1000,
        open: round(open, 4),
        high: round(high, 4),
        low: round(low, 4),
        close: round(close, 4),
        volume: Number.isFinite(volume) ? Math.max(0, Math.round(volume)) : 0
      });
    }
  }
  return { meta, candles };
}

async function fetchChart(symbol, attempt = 1) {
  const [{ meta, candles }, dailyResult] = await Promise.all([
    fetchYahooChart(symbol, '1d', '1m'),
    fetchYahooChart(symbol, '1y', '1d').catch(() => ({ candles: [] }))
  ]);
  const dailyCandles = dailyResult.candles || [];
  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close;
  if (!Number.isFinite(price) || price <= 0) throw new Error(`Bad price ${price}`);
  const latest = candles.at(-1);
  return {
    yahooSymbol: symbol,
    quote: {
      ltp: round(price, 2),
      prevClose: round(prevClose, 2),
      open: round(candles[0]?.open ?? price, 2),
      high: round(meta.regularMarketDayHigh && meta.regularMarketDayHigh > 0 ? meta.regularMarketDayHigh : Math.max(...candles.map(c => c.high)), 2),
      low: round(meta.regularMarketDayLow && meta.regularMarketDayLow > 0 ? meta.regularMarketDayLow : Math.min(...candles.map(c => c.low)), 2),
      volume: Math.round(meta.regularMarketVolume ?? candles.reduce((a,c)=>a+c.volume,0)),
      timestamp: (meta.regularMarketTime ? meta.regularMarketTime * 1000 : latest?.time ?? Date.now()),
      exchange: meta.fullExchangeName || meta.exchangeName || 'NSE',
      currency: meta.currency || 'INR',
      longName: meta.longName || meta.shortName || symbol
    },
    candles: candles.slice(-220),
    dailyCandles: dailyCandles.slice(-260)
  };
}

async function robustFetch(symbol) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try { return await fetchChart(symbol, attempt); }
    catch (e) { lastErr = e; await sleep(500 * attempt); }
  }
  throw lastErr;
}

async function fetchAllPass(passName) {
  const stocks = {};
  const indices = {};
  const failures = [];
  const all = [...INDEX_MAP.map(x => ({...x, type: 'index'})), ...STOCK_UNIVERSE.map(s => ({...s, yahoo: yahooSymbol(s.symbol), type: 'stock'}))];
  for (const item of all) {
    try {
      const data = await robustFetch(item.yahoo);
      if (item.type === 'stock') stocks[item.symbol] = data;
      else indices[item.symbol] = data;
      console.log(`[${passName}] OK`, item.symbol, data.quote.ltp, new Date(data.quote.timestamp).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }));
    } catch (error) {
      failures.push({ symbol: item.symbol, yahoo: item.yahoo, error: String(error.message || error) });
      console.error(`[${passName}] FAIL`, item.symbol, error.message || error);
    }
    await sleep(120);
  }
  return { stocks, indices, failures };
}

function compare(pass1, pass2) {
  const checks = [];
  let mismatches = 0;
  for (const s of STOCK_UNIVERSE) {
    const a = pass1.stocks[s.symbol]?.quote?.ltp;
    const b = pass2.stocks[s.symbol]?.quote?.ltp;
    const ok = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(0.25, b * 0.004);
    if (!ok) mismatches += 1;
    checks.push({ symbol: s.symbol, pass1: a ?? null, pass2: b ?? null, accepted: b ?? a ?? null, ok });
  }
  for (const i of INDEX_MAP) {
    const a = pass1.indices[i.symbol]?.quote?.ltp;
    const b = pass2.indices[i.symbol]?.quote?.ltp;
    const ok = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= Math.max(1, b * 0.004);
    if (!ok) mismatches += 1;
    checks.push({ symbol: i.symbol, pass1: a ?? null, pass2: b ?? null, accepted: b ?? a ?? null, ok });
  }
  return { total: checks.length, mismatches, checks };
}

const startedAt = new Date().toISOString();
console.log('Fetching pass 1...');
const pass1 = await fetchAllPass('pass1');
console.log('Fetching pass 2 for validation...');
const pass2 = await fetchAllPass('pass2');
const validation = compare(pass1, pass2);

const merged = {
  source: 'Yahoo Finance chart endpoint',
  status: 'DELAYED',
  note: 'Public Yahoo Finance data can be delayed and is not a licensed real-time NSE/BSE feed. Use official broker/vendor API for LIVE status.',
  fetchedAt: Date.now(),
  fetchedAtIso: new Date().toISOString(),
  startedAt,
  stocks: { ...pass1.stocks, ...pass2.stocks },
  indices: { ...pass1.indices, ...pass2.indices },
  failures: [...pass1.failures, ...pass2.failures],
  validation: {
    ...validation,
    ok: validation.mismatches === 0 && pass2.failures.length === 0,
    failedSymbols: [...new Set([...pass1.failures, ...pass2.failures].map(f => f.symbol))]
  }
};

const js = `// Auto-generated by scripts/fetch_latest_snapshot.mjs\n// Data source: ${merged.source}. Status: ${merged.status}.\n// Generated: ${merged.fetchedAtIso}\nexport const LIVE_SNAPSHOT = ${JSON.stringify(merged)};\n`;
writeFileSync(OUT, js);
writeFileSync(REPORT, JSON.stringify(merged.validation, null, 2));
console.log('Wrote', OUT.pathname);
console.log('Validation', merged.validation.ok ? 'OK' : 'WARN', `${validation.total - validation.mismatches}/${validation.total} matched`, 'failures', merged.validation.failedSymbols.join(',') || 'none');
