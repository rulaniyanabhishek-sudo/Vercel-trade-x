import { gunzipSync } from 'node:zlib';
import { STOCK_UNIVERSE } from '../../src/data/universe.js';
import { buildIndicatorSnapshot } from '../../src/engines/indicators.js';

const NSE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/NSE.json.gz';
const COMPLETE_INSTRUMENTS_URL = 'https://assets.upstox.com/market-quote/instruments/exchange/complete.json.gz';

const INDEX_KEYS = {
  NIFTY50: 'NSE_INDEX|Nifty 50',
  BANKNIFTY: 'NSE_INDEX|Nifty Bank',
  SENSEX: 'BSE_INDEX|SENSEX'
};

const INDEX_LABELS = {
  NIFTY50: 'NIFTY 50',
  SENSEX: 'SENSEX',
  BANKNIFTY: 'NIFTY BANK'
};

const round = (value, digits = 2) => Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isIndianMarketSession(now = new Date()) {
  const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const day = ist.getDay();
  const minutes = ist.getHours() * 60 + ist.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60;
}

function yyyyMmDdFromMs(ms) {
  const d = new Date(ms);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function keyForQuoteObject(raw, instrumentKey) {
  if (!raw?.data) return null;
  if (raw.data[instrumentKey]) return raw.data[instrumentKey];
  const token = instrumentKey.split('|')[1];
  return Object.entries(raw.data).find(([key, value]) => key.includes(token) || value?.instrument_token === instrumentKey)?.[1] || null;
}

export class UpstoxProvider {
  constructor({ accessToken, apiBase = 'https://api.upstox.com/v2' } = {}) {
    if (!accessToken) throw new Error('UPSTOX_ACCESS_TOKEN is required');
    this.accessToken = accessToken;
    this.apiBase = apiBase.replace(/\/$/, '');
    this.instrumentCache = null;
    this.symbolToInstrument = new Map();
    this.optionExpiryCache = null;
  }

  async request(path, params = {}) {
    const url = new URL(`${this.apiBase}${path}`);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
    });
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.accessToken}`
      }
    });
    const text = await response.text();
    let json;
    try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
    if (!response.ok) {
      throw new Error(`Upstox API ${response.status} ${response.statusText}: ${json?.errors?.[0]?.message || json?.message || text.slice(0, 200)}`);
    }
    return json;
  }

  async fetchInstrumentMaster(url = NSE_INSTRUMENTS_URL) {
    const response = await fetch(url, { headers: { Accept: 'application/gzip,application/json,*/*' } });
    if (!response.ok) throw new Error(`Unable to fetch Upstox instrument master: ${response.status}`);
    const buf = Buffer.from(await response.arrayBuffer());
    const text = url.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    return JSON.parse(text);
  }

  async loadInstruments() {
    if (this.instrumentCache) return this.instrumentCache;
    const nse = await this.fetchInstrumentMaster(NSE_INSTRUMENTS_URL);
    let complete = [];
    try { complete = await this.fetchInstrumentMaster(COMPLETE_INSTRUMENTS_URL); } catch { complete = []; }
    const all = [...nse, ...complete];
    for (const item of all) {
      if (item.segment === 'NSE_EQ' && item.instrument_type === 'EQ' && item.trading_symbol) {
        this.symbolToInstrument.set(item.trading_symbol, item);
      }
    }
    this.instrumentCache = all;
    return all;
  }

  async getInstrumentKeyForSymbol(symbol) {
    await this.loadInstruments();
    const instrument = this.symbolToInstrument.get(symbol);
    if (!instrument?.instrument_key) throw new Error(`No Upstox instrument key found for ${symbol}`);
    return instrument.instrument_key;
  }

  async getOhlcMap(instrumentKeys, interval = '1d') {
    const chunks = [];
    for (let i = 0; i < instrumentKeys.length; i += 450) chunks.push(instrumentKeys.slice(i, i + 450));
    const merged = {};
    for (const chunk of chunks) {
      const raw = await this.request('/market-quote/ohlc', { instrument_key: chunk.join(','), interval });
      Object.assign(merged, raw.data || {});
      await sleep(80);
    }
    return merged;
  }

  quoteFromUpstox(raw, fallbackSymbol, fallbackName) {
    const last = Number(raw?.last_price ?? raw?.ltp ?? raw?.close ?? 0);
    const ohlc = raw?.ohlc || raw?.live_ohlc || {};
    const prevClose = Number(ohlc.close ?? raw?.close ?? last);
    const open = Number(ohlc.open ?? last);
    const high = Number(ohlc.high ?? last);
    const low = Number(ohlc.low ?? last);
    const volume = Math.round(Number(raw?.volume ?? raw?.volume_traded ?? 0));
    const timestamp = Date.now();
    return {
      ltp: round(last, 2),
      prevClose: round(prevClose, 2),
      open: round(open, 2),
      high: round(high, 2),
      low: round(low, 2),
      volume,
      timestamp,
      exchange: raw?.exchange || 'NSE',
      currency: 'INR',
      longName: raw?.symbol || fallbackName || fallbackSymbol
    };
  }

  makeIntradayCandles(quote, previous = []) {
    const candles = previous.length ? previous.map((c) => ({ ...c })) : [];
    const now = Date.now();
    if (!candles.length) {
      candles.push({ time: now, open: quote.open, high: quote.high, low: quote.low, close: quote.ltp, volume: Math.max(1, Math.round((quote.volume || 1) / 375)) });
      return candles;
    }
    const last = candles[candles.length - 1];
    const shouldAppend = now - last.time > 55_000;
    const candle = {
      time: now,
      open: shouldAppend ? last.close : last.open,
      high: Math.max(shouldAppend ? last.close : last.high, quote.ltp),
      low: Math.min(shouldAppend ? last.close : last.low, quote.ltp),
      close: quote.ltp,
      volume: shouldAppend ? Math.max(1, Math.round((quote.volume || 1) / 375)) : Math.max(last.volume, Math.round((quote.volume || 1) / 375))
    };
    if (shouldAppend) candles.push(candle);
    else candles[candles.length - 1] = candle;
    return candles.slice(-220);
  }

  async getMarketSnapshot(previousSnapshot = null) {
    await this.loadInstruments();
    const stockKeys = [];
    const stockKeyBySymbol = new Map();
    for (const stock of STOCK_UNIVERSE) {
      const key = await this.getInstrumentKeyForSymbol(stock.symbol);
      stockKeys.push(key);
      stockKeyBySymbol.set(stock.symbol, key);
    }
    const indexKeys = Object.values(INDEX_KEYS);
    const ohlcMap = await this.getOhlcMap([...stockKeys, ...indexKeys], '1d');
    const stocks = {};
    const failures = [];
    for (const stock of STOCK_UNIVERSE) {
      const key = stockKeyBySymbol.get(stock.symbol);
      const raw = keyForQuoteObject({ data: ohlcMap }, key);
      if (!raw) { failures.push({ symbol: stock.symbol, error: 'No Upstox quote returned' }); continue; }
      const quote = this.quoteFromUpstox(raw, stock.symbol, stock.name);
      const previous = previousSnapshot?.stocks?.[stock.symbol];
      stocks[stock.symbol] = {
        providerSymbol: key,
        quote,
        candles: this.makeIntradayCandles(quote, previous?.candles || []),
        dailyCandles: previous?.dailyCandles || []
      };
    }
    const indices = {};
    for (const [symbol, key] of Object.entries(INDEX_KEYS)) {
      const raw = keyForQuoteObject({ data: ohlcMap }, key);
      if (!raw) { failures.push({ symbol, error: 'No Upstox index quote returned' }); continue; }
      const quote = this.quoteFromUpstox(raw, symbol, INDEX_LABELS[symbol]);
      const previous = previousSnapshot?.indices?.[symbol];
      indices[symbol] = {
        providerSymbol: key,
        quote,
        candles: this.makeIntradayCandles(quote, previous?.candles || []),
        dailyCandles: previous?.dailyCandles || []
      };
    }

    const timestamps = [...Object.values(stocks), ...Object.values(indices)].map((x) => x.quote.timestamp).filter(Number.isFinite);
    const maxMarketTimestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
    const status = isIndianMarketSession() ? 'LIVE' : 'DELAYED';
    return {
      source: 'Upstox official API server adapter',
      status,
      marketSessionOpen: isIndianMarketSession(),
      note: 'Quotes fetched server-side from Upstox. Access token remains on the backend only.',
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
      maxMarketTimestamp,
      stocks,
      indices,
      validation: {
        ok: failures.length === 0,
        total: STOCK_UNIVERSE.length + Object.keys(INDEX_KEYS).length,
        received: Object.keys(stocks).length + Object.keys(indices).length,
        failures
      }
    };
  }

  async getNearestNiftyExpiryDate() {
    if (this.optionExpiryCache && Date.now() - this.optionExpiryCache.fetchedAt < 60 * 60 * 1000) return this.optionExpiryCache.expiryDate;
    const all = await this.loadInstruments();
    const now = Date.now();
    const expiries = all
      .filter((x) => x.segment === 'NSE_FO' && x.underlying_symbol === 'NIFTY' && x.instrument_type === 'CE' && Number(x.expiry) >= now)
      .map((x) => Number(x.expiry))
      .sort((a, b) => a - b);
    if (!expiries.length) throw new Error('No future NIFTY expiries found in Upstox instrument master');
    const expiryDate = yyyyMmDdFromMs(expiries[0]);
    this.optionExpiryCache = { fetchedAt: Date.now(), expiryDate };
    return expiryDate;
  }

  legFromUpstox(rawLeg) {
    const md = rawLeg?.market_data || rawLeg?.marketData || rawLeg || {};
    const oi = Number(md.oi ?? md.open_interest ?? 0) || 0;
    const prevOI = Number(md.prev_oi ?? md.previous_oi ?? md.prev_open_interest ?? oi) || oi;
    const changeOI = Number(md.oi_change ?? md.change_oi ?? (oi - prevOI)) || 0;
    const ltp = Number(md.ltp ?? md.last_price ?? 0) || 0;
    return {
      ltp: round(ltp, 2),
      oi,
      prevOI,
      changeOI,
      oiPct: prevOI ? round((changeOI / prevOI) * 100, 2) : 0,
      volume: Number(md.volume ?? md.vol ?? 0) || 0,
      bid: Number(md.bid_price ?? md.bid ?? 0) || 0,
      ask: Number(md.ask_price ?? md.ask ?? 0) || 0,
      iv: round(Number(rawLeg?.option_greeks?.iv ?? rawLeg?.greeks?.iv ?? 0) || 0, 2),
      deltaClass: { ltp: '', oi: '', changeOI: '', oiPct: '' }
    };
  }

  async getNiftyOptionSnapshot(previousTable = null, previousMarketSnapshot = null) {
    const expiryDate = process.env.UPSTOX_NIFTY_EXPIRY_DATE || await this.getNearestNiftyExpiryDate();
    const raw = await this.request('/option/chain', { instrument_key: INDEX_KEYS.NIFTY50, expiry_date: expiryDate });
    const data = raw.data || [];
    if (!Array.isArray(data) || !data.length) throw new Error('Upstox option chain returned no rows');
    const prevByStrike = new Map((previousTable?.rows || []).map((r) => [String(r.strike), r]));
    const rows = data.map((row) => {
      const strike = Math.round(Number(row.strike_price ?? row.strikePrice ?? 0));
      const call = this.legFromUpstox(row.call_options || row.call || row.ce || row.CE);
      const put = this.legFromUpstox(row.put_options || row.put || row.pe || row.PE);
      const prev = prevByStrike.get(String(strike));
      const diffClass = (current, previous) => current > previous ? 'flash-up' : current < previous ? 'flash-down' : '';
      call.deltaClass = { ltp: diffClass(call.ltp, prev?.call?.ltp), oi: diffClass(call.oi, prev?.call?.oi), changeOI: diffClass(call.changeOI, prev?.call?.changeOI), oiPct: diffClass(call.oiPct, prev?.call?.oiPct) };
      put.deltaClass = { ltp: diffClass(put.ltp, prev?.put?.ltp), oi: diffClass(put.oi, prev?.put?.oi), changeOI: diffClass(put.changeOI, prev?.put?.changeOI), oiPct: diffClass(put.oiPct, prev?.put?.oiPct) };
      return { strike, call, put };
    }).filter((r) => r.strike > 0).sort((a, b) => a.strike - b.strike);
    const totals = {
      totalCallOI: rows.reduce((a, r) => a + r.call.oi, 0),
      totalPutOI: rows.reduce((a, r) => a + r.put.oi, 0),
      totalCallChangeOI: rows.reduce((a, r) => a + r.call.changeOI, 0),
      totalPutChangeOI: rows.reduce((a, r) => a + r.put.changeOI, 0)
    };
    const spot = Number(data[0]?.underlying_spot_price ?? data[0]?.underlyingSpotPrice ?? previousMarketSnapshot?.indices?.NIFTY50?.quote?.ltp ?? 0);
    const atm = rows.reduce((best, row) => Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best, rows[0]);
    const candles = previousMarketSnapshot?.indices?.NIFTY50?.candles || [];
    const indicator = candles.length ? buildIndicatorSnapshot(candles) : { vwap: spot, relVolume: 1 };
    const pcr = totals.totalPutOI / Math.max(1, totals.totalCallOI);
    const diff = totals.totalPutOI - totals.totalCallOI;
    const priceAboveVwap = spot >= (indicator.vwap || spot);
    const putWritingLead = totals.totalPutChangeOI > totals.totalCallChangeOI * 1.05;
    const callWritingLead = totals.totalCallChangeOI > totals.totalPutChangeOI * 1.05;
    const bullishVotes = [pcr > 1, diff > 0, putWritingLead, priceAboveVwap].filter(Boolean).length;
    const bearishVotes = [pcr < 1, diff < 0, callWritingLead, !priceAboveVwap].filter(Boolean).length;
    const optionSignal = bullishVotes >= 3 ? 'BUY' : bearishVotes >= 3 ? 'SELL' : 'NEUTRAL';
    const vwapSignal = priceAboveVwap && bullishVotes >= 2 ? 'BUY' : !priceAboveVwap && bearishVotes >= 2 ? 'SELL' : 'NEUTRAL';
    const timestamp = Date.now();
    return {
      source: 'Upstox official option-chain API',
      status: isIndianMarketSession() ? 'LIVE' : 'MARKET_CLOSED',
      marketOpen: isIndianMarketSession(),
      fetchedAt: timestamp,
      fetchedAtIso: new Date(timestamp).toISOString(),
      underlying: 'NIFTY 50',
      expiryLabel: expiryDate,
      spot: round(spot, 2),
      atmStrike: atm?.strike || Math.round(spot / 50) * 50,
      rows,
      totals,
      reading: {
        timestamp,
        time: new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(timestamp)),
        callOI: totals.totalCallOI,
        putOI: totals.totalPutOI,
        callChangeOI: totals.totalCallChangeOI,
        putChangeOI: totals.totalPutChangeOI,
        pcr: round(pcr, 2),
        diff,
        optionSignal,
        vwap: round(indicator.vwap || spot, 2),
        currentPrice: round(spot, 2),
        vwapSignal,
        bullishVotes,
        bearishVotes,
        volumeOk: true,
        trendPct: 0
      },
      validation: { ok: rows.length > 0, rows: rows.length, expiryDate }
    };
  }
}

export function createUpstoxProviderFromEnv() {
  const token = process.env.UPSTOX_ACCESS_TOKEN || process.env.UPSTOX_TOKEN;
  if (!token) return null;
  return new UpstoxProvider({ accessToken: token, apiBase: process.env.UPSTOX_API_BASE || undefined });
}
