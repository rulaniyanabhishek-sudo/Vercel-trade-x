import { STOCK_UNIVERSE } from '../src/data/universe.js';
import { NIFTY_OPTION_SNAPSHOT } from '../src/data/niftyOptionSnapshot.js';
import { createUpstoxProviderFromEnv } from './providers/upstox-provider.mjs';

const INDEX_MAP = [
  { symbol: 'NIFTY50', label: 'NIFTY 50', yahoo: '^NSEI' },
  { symbol: 'SENSEX', label: 'SENSEX', yahoo: '^BSESN' },
  { symbol: 'BANKNIFTY', label: 'NIFTY BANK', yahoo: '^NSEBANK' },
  { symbol: 'INDIAVIX', label: 'India VIX', yahoo: '^INDIAVIX' }
];

const round = (value, digits = 2) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let cache = null;
let refreshPromise = null;
let optionTableCache = NIFTY_OPTION_SNAPSHOT?.validation?.ok ? NIFTY_OPTION_SNAPSHOT : null;
let optionTableRefreshPromise = null;
const officialProvider = createUpstoxProviderFromEnv();
const dailyCache = new Map();

export function yahooSymbol(symbol) {
  return `${symbol}.NS`;
}

export function isIndianMarketSession(now = new Date()) {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60;
}

function classifyStatus(maxTimestamp) {
  const ageMs = Math.max(0, Date.now() - (maxTimestamp || 0));
  if (isIndianMarketSession()) {
    if (ageMs <= 2.5 * 60 * 1000) return 'LIVE';
    if (ageMs <= 25 * 60 * 1000) return 'DELAYED';
    return 'STALE';
  }
  if (ageMs <= 48 * 60 * 60 * 1000) return 'DELAYED';
  return 'STALE';
}

async function fetchYahooChart(symbol, range = '1d', interval = '1m') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 TradeX-LiveServer/1.0',
      Accept: 'application/json,text/plain,*/*'
    }
  });
  if (!response.ok) throw new Error(`${symbol}: ${response.status} ${response.statusText}`);
  const data = await response.json();
  if (data?.chart?.error) throw new Error(`${symbol}: ${data.chart.error.description || 'chart error'}`);
  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`${symbol}: missing chart meta`);
  const meta = result.meta;
  const q = result.indicators?.quote?.[0] || {};
  const timestamps = result.timestamp || [];
  const candles = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const open = q.open?.[i];
    const high = q.high?.[i];
    const low = q.low?.[i];
    const close = q.close?.[i];
    const volume = q.volume?.[i];
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

async function getDailyCandles(symbol) {
  const cached = dailyCache.get(symbol);
  const ttl = Number(process.env.BQ_DAILY_TTL_MS || 6 * 60 * 60 * 1000);
  if (cached && Date.now() - cached.fetchedAt < ttl) return cached.candles;
  const result = await fetchYahooChart(symbol, '1y', '1d');
  const candles = result.candles.slice(-260);
  if (candles.length) dailyCache.set(symbol, { fetchedAt: Date.now(), candles });
  return candles;
}

async function fetchChart(symbol) {
  const { meta, candles } = await fetchYahooChart(symbol, '1d', '1m');
  const dailyCandles = await getDailyCandles(symbol).catch(() => []);
  const prevClose = meta.previousClose ?? meta.chartPreviousClose;
  const price = meta.regularMarketPrice ?? candles.at(-1)?.close;
  if (!Number.isFinite(price) || price <= 0) throw new Error(`${symbol}: invalid price ${price}`);
  const dayHigh = meta.regularMarketDayHigh && meta.regularMarketDayHigh > 0 ? meta.regularMarketDayHigh : Math.max(...candles.map((c) => c.high));
  const dayLow = meta.regularMarketDayLow && meta.regularMarketDayLow > 0 ? meta.regularMarketDayLow : Math.min(...candles.map((c) => c.low));
  return {
    yahooSymbol: symbol,
    quote: {
      ltp: round(price, 2),
      prevClose: round(prevClose, 2),
      open: round(candles[0]?.open ?? price, 2),
      high: round(dayHigh, 2),
      low: round(dayLow, 2),
      volume: Math.round(meta.regularMarketVolume ?? candles.reduce((acc, c) => acc + c.volume, 0)),
      timestamp: meta.regularMarketTime ? meta.regularMarketTime * 1000 : candles.at(-1)?.time ?? Date.now(),
      exchange: meta.fullExchangeName || meta.exchangeName || 'NSE',
      currency: meta.currency || 'INR',
      longName: meta.longName || meta.shortName || symbol
    },
    candles: candles.slice(-220),
    dailyCandles
  };
}

async function robustFetch(symbol) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchChart(symbol);
    } catch (error) {
      lastError = error;
      await sleep(250 * attempt);
    }
  }
  throw lastError;
}

async function mapLimit(items, limit, iterator) {
  const out = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await iterator(items[index], index);
    }
  });
  await Promise.all(workers);
  return out;
}

async function fetchAllOnce() {
  const stocks = {};
  const indices = {};
  const failures = [];
  const all = [
    ...INDEX_MAP.map((item) => ({ ...item, type: 'index' })),
    ...STOCK_UNIVERSE.map((item) => ({ ...item, yahoo: yahooSymbol(item.symbol), type: 'stock' }))
  ];

  await mapLimit(all, Number(process.env.BQ_FETCH_CONCURRENCY || 6), async (item) => {
    try {
      const data = await robustFetch(item.yahoo);
      if (item.type === 'stock') stocks[item.symbol] = data;
      else indices[item.symbol] = data;
    } catch (error) {
      failures.push({ symbol: item.symbol, yahoo: item.yahoo, error: error.message || String(error) });
    }
  });

  const timestamps = [
    ...Object.values(stocks).map((s) => s.quote.timestamp),
    ...Object.values(indices).map((i) => i.quote.timestamp)
  ].filter(Number.isFinite);
  const maxTimestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
  const status = classifyStatus(maxTimestamp);
  const validation = {
    ok: failures.length === 0 && Object.keys(indices).length === INDEX_MAP.length && Object.keys(stocks).length === STOCK_UNIVERSE.length,
    total: INDEX_MAP.length + STOCK_UNIVERSE.length,
    received: Object.keys(indices).length + Object.keys(stocks).length,
    failures
  };
  return {
    source: 'Server-side Yahoo Finance chart endpoint; use official broker/vendor credentials for exchange-certified live data',
    status,
    marketSessionOpen: isIndianMarketSession(),
    note: status === 'LIVE'
      ? 'Runtime quotes are updating during Indian market hours. For exchange-certified live data, connect an official provider.'
      : 'Quotes are delayed or stale because the market is closed or the upstream timestamp is not current.',
    fetchedAt: Date.now(),
    fetchedAtIso: new Date().toISOString(),
    maxMarketTimestamp: maxTimestamp,
    stocks,
    indices,
    validation
  };
}

export async function getMarketSnapshot({ force = false } = {}) {
  const ttl = isIndianMarketSession() ? Number(process.env.BQ_LIVE_TTL_MS || 1000) : Number(process.env.BQ_CLOSED_TTL_MS || 30000);
  if (!force && cache && Date.now() - cache.fetchedAt < ttl) return cache;
  if (!refreshPromise) {
    refreshPromise = (officialProvider
      ? officialProvider.getMarketSnapshot(cache).catch(async (error) => {
        console.warn('Official Upstox snapshot failed, falling back to free source:', error.message || error);
        return fetchAllOnce();
      })
      : fetchAllOnce())
      .then((snapshot) => {
        if (snapshot.validation.received > 0) cache = snapshot;
        return snapshot;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

export async function getNiftyOptionTableSnapshot({ force = false } = {}) {
  const ttl = isIndianMarketSession() ? Number(process.env.BQ_OPTIONS_TTL_MS || 1000) : Number(process.env.BQ_OPTIONS_CLOSED_TTL_MS || 15000);
  if (!force && optionTableCache && Date.now() - optionTableCache.fetchedAt < ttl) return optionTableCache;
  if (!optionTableRefreshPromise) {
    optionTableRefreshPromise = (officialProvider
      ? officialProvider.getNiftyOptionSnapshot(optionTableCache, cache).catch((error) => {
        console.warn('Official Upstox option-chain failed:', error.message || error);
        return optionTableCache;
      })
      : Promise.resolve(optionTableCache))
      .then((snapshot) => {
        if (snapshot?.rows?.length) optionTableCache = snapshot;
        return optionTableCache;
      })
      .finally(() => { optionTableRefreshPromise = null; });
  }
  return optionTableRefreshPromise;
}

export function getCachedSnapshot() {
  return cache;
}

export function getProviderInfo() {
  return {
    officialProvider: officialProvider ? 'upstox' : null,
    mode: officialProvider ? 'official-upstox' : 'free-fallback'
  };
}
