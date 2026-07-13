import { INDEX_DEFINITIONS, STOCK_UNIVERSE, TIMEFRAMES, PE_RATIOS, MONEYCONTROL_SC_IDS } from '../data/universe.js';
import { LIVE_SNAPSHOT } from '../data/liveSnapshot.js';
import { NIFTY_OPTION_SNAPSHOT } from '../data/niftyOptionSnapshot.js';
import { EventBus } from '../core/events.js';
import { average, clamp, formatTime, hashString, normalish, percentDistance, round, seededRandom } from '../core/utils.js';
import { buildIndicatorSnapshot, candleAggregation, relativeVolume, vwap } from '../engines/indicators.js';
import { MarketDataProvider } from './marketDataProvider.js';

const INDEX_YAHOO_SYMBOLS = {
  NIFTY50: '^NSEI',
  SENSEX: '^BSESN',
  BANKNIFTY: '^NSEBANK',
  INDIAVIX: '^INDIAVIX'
};

const PRICE_REFRESH_MS = 1000;
const CLOSED_MARKET_REFRESH_MS = 30000;

const SECTOR_BIAS = {
  Banking: 0.004,
  IT: -0.002,
  Auto: 0.003,
  FMCG: 0.001,
  Metals: -0.001,
  Pharma: 0.002,
  Energy: 0.001,
  Power: 0.002,
  Retail: 0.003,
  Telecom: 0.002
};

function timeframeGroup(timeframe) {
  const tf = TIMEFRAMES.find((t) => t.id === timeframe) ?? TIMEFRAMES[1];
  return Math.max(1, Math.round(tf.minutes));
}

export class DemoMarketDataProvider extends MarketDataProvider {
  constructor() {
    super('DemoMarketDataProvider');
    this.liveSnapshot = LIVE_SNAPSHOT?.validation?.ok ? LIVE_SNAPSHOT : null;
    this.status = this.liveSnapshot?.status || (this.liveSnapshot ? 'DELAYED' : 'DEMO');
    this.networkRefreshInFlight = false;
    this.lastNetworkAttempt = 0;
    this.bus = new EventBus();
    this.rand = seededRandom(20260710);
    this.clock = Date.now();
    this.timer = null;
    this.stockStates = new Map();
    this.indexStates = new Map();
    this.snapshot = null;
    this.niftyTableSnapshot = NIFTY_OPTION_SNAPSHOT?.validation?.ok ? NIFTY_OPTION_SNAPSHOT : null;
    this.niftyTableInFlight = false;
    this.lastNiftyTableAttempt = 0;
    this.activeRoute = 'dashboard';
    this.generateInitialState();
  }

  async connect() {
    this.status = this.liveSnapshot?.status || (this.liveSnapshot ? 'DELAYED' : 'DEMO');
    // If a same-origin live API is available, hydrate from it immediately.
    // In static GitHub Pages this silently falls back to the embedded verified snapshot.
    // Do not block first paint. Embedded verified snapshots render immediately;
    // free live feeds refresh in the background and update the UI when available.
    Promise.all([
      this.refreshFromNetwork({ silent: true, force: true }),
      this.refreshNiftyOptionTable({ silent: true, force: true })
    ]).then(() => {
      this.snapshot = this.buildSnapshot();
      this.bus.emit('snapshot', this.snapshot);
    });
    if (!this.timer) {
      // Fire the refresh scheduler every second. refreshFromNetwork prevents
      // overlapping requests; during market hours it attempts a new price pull
      // every 1 second, and outside market hours it slows down internally.
      this.timer = setInterval(async () => {
        const tasks = [this.refreshFromNetwork({ silent: true })];
        if (this.activeRoute === 'table') tasks.push(this.refreshNiftyOptionTable({ silent: true }));
        const results = await Promise.all(tasks);
        const refreshed = results.some(Boolean);
        if (!refreshed && !this.liveSnapshot) this.step();
        else {
          this.snapshot = this.buildSnapshot();
          this.bus.emit('snapshot', this.snapshot);
        }
      }, PRICE_REFRESH_MS);
    }
    this.snapshot = this.buildSnapshot();
    queueMicrotask(() => this.bus.emit('snapshot', this.snapshot));
    return this.snapshot;
  }

  disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  subscribe(callback) {
    callback(this.snapshot ?? this.buildSnapshot());
    return this.bus.on('snapshot', callback);
  }

  getSnapshot() {
    return this.snapshot ?? this.buildSnapshot();
  }

  getCandles(symbol, timeframe = '5m') {
    const state = this.stockStates.get(symbol);
    if (!state) return [];
    if (timeframe === '1d' && state.dailyCandles?.length) return [...state.dailyCandles];
    if (timeframe === '1w' && state.dailyCandles?.length) return candleAggregation(state.dailyCandles, 5);
    return candleAggregation(state.candles, timeframeGroup(timeframe));
  }

  getIndexCandles(symbol, timeframe = '5m') {
    const state = this.indexStates.get(symbol);
    if (!state) return [];
    if (timeframe === '1d' && state.dailyCandles?.length) return [...state.dailyCandles];
    if (timeframe === '1w' && state.dailyCandles?.length) return candleAggregation(state.dailyCandles, 5);
    return candleAggregation(state.candles, timeframeGroup(timeframe));
  }


  getNiftyOptionTableSnapshot() {
    return this.niftyTableSnapshot;
  }

  isIndianMarketSession(now = new Date()) {
    const ist = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const day = ist.getDay();
    const minutes = ist.getHours() * 60 + ist.getMinutes();
    // User requested live analysis during market hours; use 09:00-15:00 IST.
    return day >= 1 && day <= 5 && minutes >= 9 * 60 && minutes <= 15 * 60;
  }

  async refreshFromNetwork({ silent = false, force = false } = {}) {
    if (typeof window === 'undefined' || typeof fetch === 'undefined') return false;
    const now = Date.now();
    const minGap = this.isIndianMarketSession() ? PRICE_REFRESH_MS : CLOSED_MARKET_REFRESH_MS;
    if (this.networkRefreshInFlight || (!force && now - this.lastNetworkAttempt < minGap)) return false;
    this.networkRefreshInFlight = true;
    this.lastNetworkAttempt = now;
    try {
      const bases = [];
      if (window.BQ_LIVE_API_BASE) bases.push(String(window.BQ_LIVE_API_BASE).replace(/\/$/, ''));
      if (window.location?.origin && window.location.origin !== 'null') bases.push(window.location.origin);
      for (const base of [...new Set(bases)]) {
        try {
          const response = await fetch(`${base}/api/market/snapshot?ts=${Date.now()}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const json = await response.json();
          const stockCount = Object.keys(json?.stocks || {}).length;
          const indexCount = Object.keys(json?.indices || {}).length;
          if (stockCount < 20 || indexCount < 3 || json?.validation?.ok === false) continue;
          this.applyVerifiedSnapshot(json);
          return true;
        } catch (error) {
          if (!silent) console.warn('Live API refresh failed', error);
        }
      }

      const freeSnapshot = await this.fetchFrontendFreeSnapshot({ silent });
      if (freeSnapshot) {
        this.applyVerifiedSnapshot(freeSnapshot);
        return true;
      }
    } finally {
      this.networkRefreshInFlight = false;
    }
    return false;
  }

  yahooSymbolFor(item) {
    return item.yahoo || INDEX_YAHOO_SYMBOLS[item.symbol] || `${item.symbol}.NS`;
  }

  async fetchJsonWithFallback(rawUrl, timeoutMs = 11000) {
    const urls = [
      rawUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`,
      `https://thingproxy.freeboard.io/fetch/${rawUrl}`
    ];
    let lastError = null;
    for (const url of urls) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const text = await response.text();
        const trimmed = text.trim();
        const jsonText = trimmed.startsWith('cb(') ? trimmed.slice(3, -1) : trimmed;
        return JSON.parse(jsonText);
      } catch (error) {
        lastError = error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError || new Error('All frontend quote fetch methods failed');
  }

  async fetchTextWithFallback(rawUrl, timeoutMs = 12000) {
    const urls = [
      rawUrl,
      `https://api.allorigins.win/raw?url=${encodeURIComponent(rawUrl)}`,
      `https://corsproxy.io/?${encodeURIComponent(rawUrl)}`,
      `https://thingproxy.freeboard.io/fetch/${rawUrl}`
    ];
    let lastError = null;
    for (const url of urls) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller?.signal });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return await response.text();
      } catch (error) {
        lastError = error;
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    }
    throw lastError || new Error('All frontend text fetch methods failed');
  }

  parseYahooChart(symbol, data) {
    if (data?.chart?.error) throw new Error(data.chart.error.description || 'Yahoo chart error');
    const result = data?.chart?.result?.[0];
    if (!result?.meta) throw new Error('Missing chart result');
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
    const prevClose = meta.previousClose ?? meta.chartPreviousClose;
    const price = meta.regularMarketPrice ?? candles.at(-1)?.close;
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Bad price for ${symbol}`);
    return {
      yahooSymbol: symbol,
      quote: {
        ltp: round(price, 2),
        prevClose: round(prevClose, 2),
        open: round(candles[0]?.open ?? price, 2),
        high: round(meta.regularMarketDayHigh && meta.regularMarketDayHigh > 0 ? meta.regularMarketDayHigh : Math.max(...candles.map((c) => c.high)), 2),
        low: round(meta.regularMarketDayLow && meta.regularMarketDayLow > 0 ? meta.regularMarketDayLow : Math.min(...candles.map((c) => c.low)), 2),
        volume: Math.round(meta.regularMarketVolume ?? candles.reduce((acc, c) => acc + c.volume, 0)),
        timestamp: meta.regularMarketTime ? meta.regularMarketTime * 1000 : candles.at(-1)?.time ?? Date.now(),
        exchange: meta.fullExchangeName || meta.exchangeName || 'NSE',
        currency: meta.currency || 'INR',
        longName: meta.longName || meta.shortName || symbol
      },
      candles: candles.slice(-220)
    };
  }

  async fetchFrontendChart(yahooSymbol) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1m&includePrePost=false&_=${Date.now()}`;
    const data = await this.fetchJsonWithFallback(url);
    return this.parseYahooChart(yahooSymbol, data);
  }

  classifyStatusFromTimestamp(maxTimestamp) {
    const ageMs = Math.max(0, Date.now() - (maxTimestamp || 0));
    if (this.isIndianMarketSession()) {
      if (ageMs <= 3 * 60 * 1000) return 'LIVE';
      if (ageMs <= 25 * 60 * 1000) return 'DELAYED';
      return 'STALE';
    }
    return ageMs <= 48 * 60 * 60 * 1000 ? 'DELAYED' : 'STALE';
  }

  parseMoneycontrolStock(stock, data) {
    const d = data?.data;
    if (!d || data?.code !== '200') throw new Error(data?.message || 'Moneycontrol returned no data');
    const num = (value, fallback = 0) => {
      const n = Number(String(value ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : fallback;
    };
    const previous = this.liveSnapshot?.stocks?.[stock.symbol];
    const baseCandles = previous?.candles?.length ? previous.candles.map((c) => ({ ...c })) : [];
    const ltp = num(d.pricecurrent, previous?.quote?.ltp || stock.basePrice);
    const prevClose = num(d.priceprevclose, previous?.quote?.prevClose || ltp);
    const open = num(d.OPN, previous?.quote?.open || ltp);
    const high = num(d.HP, Math.max(open, ltp));
    const low = num(d.LP, Math.min(open, ltp));
    const volume = Math.round(num(d.VOL, previous?.quote?.volume || 0));
    const now = Date.now();
    if (baseCandles.length) {
      const last = baseCandles[baseCandles.length - 1];
      const shouldAppend = now - last.time > 55_000;
      const candle = {
        time: now,
        open: shouldAppend ? last.close : last.open,
        high: Math.max(shouldAppend ? last.close : last.high, ltp),
        low: Math.min(shouldAppend ? last.close : last.low, ltp),
        close: ltp,
        volume: shouldAppend ? Math.max(1, Math.round(volume / 375)) : Math.max(last.volume, Math.round(volume / 375))
      };
      if (shouldAppend) baseCandles.push(candle);
      else baseCandles[baseCandles.length - 1] = candle;
    } else {
      baseCandles.push({ time: now, open, high, low, close: ltp, volume: Math.max(1, Math.round(volume / 375)) });
    }
    return {
      yahooSymbol: `${stock.symbol}.NS`,
      quote: {
        ltp: round(ltp, 2),
        prevClose: round(prevClose, 2),
        open: round(open, 2),
        high: round(high, 2),
        low: round(low, 2),
        volume,
        timestamp: now,
        exchange: 'NSE',
        currency: 'INR',
        longName: stock.name
      },
      candles: baseCandles.slice(-220),
      dailyCandles: previous?.dailyCandles || []
    };
  }

  parseMoneycontrolIndex(index, key, data) {
    const d = data?.data;
    if (!d || data?.code !== '200') throw new Error(data?.message || 'Moneycontrol index returned no data');
    const num = (value, fallback = 0) => {
      const n = Number(String(value ?? '').replace(/,/g, ''));
      return Number.isFinite(n) ? n : fallback;
    };
    const previous = this.liveSnapshot?.indices?.[index.symbol];
    const baseCandles = previous?.candles?.length ? previous.candles.map((c) => ({ ...c })) : [];
    const ltp = num(d.pricecurrent ?? d.lastprice ?? d.LAST ?? d.PRICE, previous?.quote?.ltp || index.base);
    const prevClose = num(d.priceprevclose ?? d.PCLOSE ?? d.prev_close, previous?.quote?.prevClose || ltp);
    const open = num(d.OPN ?? d.OPEN, previous?.quote?.open || ltp);
    const high = num(d.HIGH ?? d.HP, Math.max(open, ltp));
    const low = num(d.LOW ?? d.LP, Math.min(open, ltp));
    const now = Date.now();
    if (baseCandles.length) {
      const last = baseCandles[baseCandles.length - 1];
      const shouldAppend = now - last.time > 55_000;
      const candle = { time: now, open: shouldAppend ? last.close : last.open, high: Math.max(shouldAppend ? last.close : last.high, ltp), low: Math.min(shouldAppend ? last.close : last.low, ltp), close: ltp, volume: 1000000 };
      if (shouldAppend) baseCandles.push(candle);
      else baseCandles[baseCandles.length - 1] = candle;
    } else {
      baseCandles.push({ time: now, open, high, low, close: ltp, volume: 1000000 });
    }
    return {
      yahooSymbol: INDEX_YAHOO_SYMBOLS[index.symbol] || key,
      quote: { ltp: round(ltp, 2), prevClose: round(prevClose, 2), open: round(open, 2), high: round(high, 2), low: round(low, 2), volume: 0, timestamp: now, exchange: index.exchange, currency: 'INR', longName: index.label },
      candles: baseCandles.slice(-220),
      dailyCandles: previous?.dailyCandles || []
    };
  }

  async fetchMoneycontrolFrontendSnapshot({ silent = false } = {}) {
    const previous = this.liveSnapshot || { stocks: {}, indices: {} };
    const stocks = { ...(previous.stocks || {}) };
    const indices = { ...(previous.indices || {}) };
    const failures = [];
    let freshReceived = 0;
    const stockItems = STOCK_UNIVERSE.filter((stock) => MONEYCONTROL_SC_IDS[stock.symbol]);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(20, stockItems.length) }, async () => {
      while (cursor < stockItems.length) {
        const stock = stockItems[cursor++];
        try {
          const scid = MONEYCONTROL_SC_IDS[stock.symbol];
          const url = `https://priceapi.moneycontrol.com/pricefeed/nse/equitycash/${encodeURIComponent(scid)}?_=${Date.now()}`;
          const data = await this.fetchJsonWithFallback(url);
          stocks[stock.symbol] = this.parseMoneycontrolStock(stock, data);
          freshReceived += 1;
        } catch (error) {
          failures.push({ symbol: stock.symbol, source: 'moneycontrol', error: error.message || String(error) });
          if (!silent) console.warn('Moneycontrol quote failed', stock.symbol, error);
        }
      }
    });
    await Promise.all(workers);
    const indexMap = { NIFTY50: 'NSX', SENSEX: 'SEN' };
    for (const idx of INDEX_DEFINITIONS.filter((i) => indexMap[i.symbol])) {
      try {
        const key = indexMap[idx.symbol];
        const url = `https://priceapi.moneycontrol.com/pricefeed/notapplicable/inidicesindia/in%3B${key}?_=${Date.now()}`;
        const data = await this.fetchJsonWithFallback(url);
        indices[idx.symbol] = this.parseMoneycontrolIndex(idx, key, data);
        freshReceived += 1;
      } catch (error) {
        failures.push({ symbol: idx.symbol, source: 'moneycontrol-index', error: error.message || String(error) });
      }
    }
    if (freshReceived < Math.min(10, stockItems.length)) return null;
    const status = this.isIndianMarketSession() ? 'LIVE' : 'DELAYED';
    const total = STOCK_UNIVERSE.length + INDEX_DEFINITIONS.length;
    return {
      source: 'Frontend free Moneycontrol pricefeed (CORS-enabled) with Yahoo fallback; not exchange-certified',
      status,
      marketSessionOpen: this.isIndianMarketSession(),
      note: status === 'LIVE' ? 'Moneycontrol free frontend feed is updating during market hours.' : 'Moneycontrol feed is delayed because the market is closed.',
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
      maxMarketTimestamp: Date.now(),
      stocks,
      indices,
      validation: {
        ok: failures.length === 0,
        total,
        received: freshReceived,
        fullCount: Object.keys(stocks).length + Object.keys(indices).length,
        usedFallbackCount: Math.max(0, total - freshReceived),
        failures
      }
    };
  }

  async fetchFrontendFreeSnapshot({ silent = false } = {}) {
    const moneycontrol = await this.fetchMoneycontrolFrontendSnapshot({ silent });
    if (moneycontrol) return moneycontrol;
    const previous = this.liveSnapshot || { stocks: {}, indices: {} };
    const stocks = { ...(previous.stocks || {}) };
    const indices = { ...(previous.indices || {}) };
    const failures = [];
    const items = [
      ...INDEX_DEFINITIONS.map((item) => ({ ...item, type: 'index', yahoo: INDEX_YAHOO_SYMBOLS[item.symbol] })),
      ...STOCK_UNIVERSE.map((item) => ({ ...item, type: 'stock', yahoo: `${item.symbol}.NS` }))
    ];
    let cursor = 0;
    let freshReceived = 0;
    let maxTimestamp = 0;
    const workers = Array.from({ length: Math.min(5, items.length) }, async () => {
      while (cursor < items.length) {
        const item = items[cursor++];
        try {
          const fetched = await this.fetchFrontendChart(this.yahooSymbolFor(item));
          const existing = item.type === 'stock' ? previous.stocks?.[item.symbol] : previous.indices?.[item.symbol];
          fetched.dailyCandles = existing?.dailyCandles || [];
          if (item.type === 'stock') stocks[item.symbol] = fetched;
          else indices[item.symbol] = fetched;
          maxTimestamp = Math.max(maxTimestamp, fetched.quote.timestamp || 0);
          freshReceived += 1;
        } catch (error) {
          failures.push({ symbol: item.symbol, yahoo: this.yahooSymbolFor(item), error: error.message || String(error) });
          if (!silent) console.warn('Free frontend quote fetch failed', item.symbol, error);
        }
      }
    });
    await Promise.all(workers);
    const total = items.length;
    const fullCount = Object.keys(stocks).length + Object.keys(indices).length;
    if (freshReceived < Math.min(8, total) && fullCount < total) return null;
    if (!maxTimestamp) {
      const timestamps = [
        ...Object.values(stocks).map((s) => s.quote?.timestamp),
        ...Object.values(indices).map((i) => i.quote?.timestamp)
      ].filter(Number.isFinite);
      maxTimestamp = timestamps.length ? Math.max(...timestamps) : Date.now();
    }
    const status = this.classifyStatusFromTimestamp(maxTimestamp);
    return {
      source: 'Frontend free Yahoo chart feed with CORS fallback proxies; not exchange-certified',
      status,
      marketSessionOpen: this.isIndianMarketSession(),
      note: status === 'LIVE' ? 'Frontend free feed is updating during market hours.' : 'Frontend free feed is delayed/stale or market is closed.',
      fetchedAt: Date.now(),
      fetchedAtIso: new Date().toISOString(),
      maxMarketTimestamp: maxTimestamp,
      stocks,
      indices,
      validation: {
        ok: failures.length === 0,
        total,
        received: freshReceived,
        fullCount,
        usedFallbackCount: Math.max(0, total - freshReceived),
        failures
      }
    };
  }

  applyVerifiedSnapshot(snapshot) {
    this.liveSnapshot = snapshot;
    this.status = snapshot.status || (this.isIndianMarketSession() ? 'LIVE' : 'DELAYED');
    this.stockStates.clear();
    this.indexStates.clear();
    this.loadVerifiedSnapshotState();
    this.snapshot = this.buildSnapshot();
    this.bus.emit('snapshot', this.snapshot);
  }

  loadVerifiedSnapshotState() {
    let maxTs = 0;
    STOCK_UNIVERSE.forEach((stock) => {
      const live = this.liveSnapshot.stocks?.[stock.symbol];
      if (!live?.quote || !live?.candles?.length) return;
      const candles = live.candles.map((c) => ({ ...c }));
      const q = live.quote;
      const latest = candles[candles.length - 1];
      if (latest && Number.isFinite(q.ltp)) {
        latest.close = q.ltp;
        latest.high = Math.max(latest.high, q.ltp);
        latest.low = Math.min(latest.low, q.ltp);
      }
      maxTs = Math.max(maxTs, q.timestamp || latest?.time || 0);
      this.stockStates.set(stock.symbol, {
        stock: { ...stock, basePrice: q.ltp, name: stock.name || q.longName },
        prevClose: q.prevClose || q.ltp,
        candles,
        dailyCandles: live.dailyCandles?.length ? live.dailyCandles.map((c) => ({ ...c })) : [],
        drift: 0,
        rand: seededRandom(hashString(stock.symbol)),
        sourceQuote: q,
        source: this.liveSnapshot.source,
        dataStatus: this.status
      });
    });

    INDEX_DEFINITIONS.forEach((idx) => {
      const live = this.liveSnapshot.indices?.[idx.symbol];
      if (!live?.quote || !live?.candles?.length) return;
      const candles = live.candles.map((c) => ({ ...c }));
      const q = live.quote;
      const latest = candles[candles.length - 1];
      if (latest && Number.isFinite(q.ltp)) {
        latest.close = q.ltp;
        latest.high = Math.max(latest.high, q.ltp);
        latest.low = Math.min(latest.low, q.ltp);
      }
      maxTs = Math.max(maxTs, q.timestamp || latest?.time || 0);
      this.indexStates.set(idx.symbol, {
        index: { ...idx, base: q.ltp },
        prevClose: q.prevClose || q.ltp,
        candles,
        dailyCandles: live.dailyCandles?.length ? live.dailyCandles.map((c) => ({ ...c })) : [],
        rand: seededRandom(hashString(idx.symbol)),
        sourceQuote: q,
        source: this.liveSnapshot.source,
        dataStatus: this.status
      });
    });
    this.clock = maxTs || this.liveSnapshot.fetchedAt || Date.now();
    this.snapshot = this.buildSnapshot();
  }

  generateInitialState() {
    if (this.liveSnapshot) {
      this.loadVerifiedSnapshotState();
      return;
    }
    const start = this.clock - 190 * 60 * 1000;
    STOCK_UNIVERSE.forEach((stock) => {
      const seed = hashString(stock.symbol);
      const rand = seededRandom(seed);
      const drift = (rand() - 0.48) * 0.011 + (SECTOR_BIAS[stock.sector] ?? 0);
      const prevClose = stock.basePrice * (1 + (rand() - 0.5) * 0.018);
      const open = prevClose * (1 + (rand() - 0.5) * 0.009);
      const candles = [];
      let price = open;
      for (let i = 0; i < 190; i += 1) {
        const regimeWave = Math.sin((i + seed % 31) / 29) * 0.015;
        const movePct = drift + regimeWave + normalish(rand) * 0.072;
        const next = price * (1 + movePct / 100);
        const range = Math.max(stock.basePrice * 0.0007, Math.abs(next - price) * (1.1 + rand() * 2.0));
        const high = Math.max(price, next) + range * rand();
        const low = Math.min(price, next) - range * rand();
        const vol = Math.max(1000, Math.round(stock.avgVolume / 375 * (0.55 + rand() * 1.8) * (1 + Math.abs(movePct) * 5)));
        candles.push({ time: start + i * 60000, open: price, high, low, close: next, volume: vol });
        price = next;
      }
      this.stockStates.set(stock.symbol, { stock, prevClose, candles, drift, rand });
    });

    INDEX_DEFINITIONS.forEach((idx) => {
      const rand = seededRandom(hashString(idx.symbol));
      const prevClose = idx.base * (1 + (rand() - 0.5) * (idx.symbol === 'INDIAVIX' ? 0.08 : 0.012));
      const open = prevClose * (1 + (rand() - 0.5) * (idx.symbol === 'INDIAVIX' ? 0.04 : 0.006));
      const candles = [];
      let price = open;
      for (let i = 0; i < 190; i += 1) {
        const movePct = (idx.symbol === 'INDIAVIX' ? -0.004 : 0.002) + Math.sin((i + hashString(idx.symbol) % 17) / 34) * 0.010 + normalish(rand) * (idx.symbol === 'INDIAVIX' ? 0.16 : 0.035);
        const next = Math.max(idx.symbol === 'INDIAVIX' ? 8 : 100, price * (1 + movePct / 100));
        const range = Math.max(idx.base * 0.00015, Math.abs(next - price) * (1.2 + rand()));
        const high = Math.max(price, next) + range * rand();
        const low = Math.min(price, next) - range * rand();
        candles.push({ time: start + i * 60000, open: price, high, low, close: next, volume: Math.round(1000000 * (0.7 + rand())) });
        price = next;
      }
      this.indexStates.set(idx.symbol, { index: idx, prevClose, candles, rand });
    });
    this.clock = start + 190 * 60000;
    this.snapshot = this.buildSnapshot();
  }

  step() {
    this.clock += 60000;
    const breadthPulse = normalish(this.rand) * 0.025;
    const bankPulse = breadthPulse + normalish(this.rand) * 0.018;
    const itPulse = breadthPulse - normalish(this.rand) * 0.012;

    for (const state of this.stockStates.values()) {
      const { stock, candles, rand, drift } = state;
      const last = candles[candles.length - 1];
      let sectorPulse = breadthPulse;
      if (stock.sector === 'Banking' || stock.sector === 'Financial Services') sectorPulse = bankPulse;
      if (stock.sector === 'IT') sectorPulse = itPulse;
      const shock = normalish(rand) * 0.095;
      const meanReversion = clamp(percentDistance(stock.basePrice, last.close) / 180, -0.018, 0.018);
      const movePct = sectorPulse + drift + shock + meanReversion;
      const close = Math.max(1, last.close * (1 + movePct / 100));
      const spread = Math.max(stock.basePrice * 0.00045, Math.abs(close - last.close) * (1.2 + rand() * 1.8));
      const high = Math.max(last.close, close) + spread * rand();
      const low = Math.min(last.close, close) - spread * rand();
      const volMult = (0.65 + rand() * 1.8) * (1 + Math.abs(movePct) * 6);
      const volume = Math.round(stock.avgVolume / 375 * volMult);
      candles.push({ time: this.clock, open: last.close, high, low, close, volume });
      if (candles.length > 360) candles.shift();
    }

    for (const state of this.indexStates.values()) {
      const idx = state.index;
      const last = state.candles[state.candles.length - 1];
      let movePct = breadthPulse + normalish(state.rand) * 0.028;
      if (idx.symbol === 'BANKNIFTY') movePct = bankPulse + normalish(state.rand) * 0.034;
      if (idx.symbol === 'SENSEX') movePct = breadthPulse * 0.88 + normalish(state.rand) * 0.022;
      if (idx.symbol === 'INDIAVIX') movePct = -breadthPulse * 5 + normalish(state.rand) * 0.20;
      const close = Math.max(idx.symbol === 'INDIAVIX' ? 8 : 100, last.close * (1 + movePct / 100));
      const range = Math.max(idx.base * 0.0001, Math.abs(close - last.close) * (1.1 + state.rand()));
      state.candles.push({ time: this.clock, open: last.close, high: Math.max(last.close, close) + range * state.rand(), low: Math.min(last.close, close) - range * state.rand(), close, volume: Math.round(1000000 * (0.6 + state.rand())) });
      if (state.candles.length > 360) state.candles.shift();
    }

    this.snapshot = this.buildSnapshot();
    this.bus.emit('snapshot', this.snapshot);
  }

  optionLegFromGroww(rawLeg) {
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
      token: rawLeg?.token || rawLeg?.growwContractId || '—'
    };
  }

  diffClass(current, previous) {
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return '';
    if (current > previous) return 'flash-up';
    if (current < previous) return 'flash-down';
    return '';
  }

  buildNiftyOptionSignal({ totals, spot, timestamp }) {
    const candles = this.getIndexCandles('NIFTY50', '1m');
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
    const optionSignal = bullishVotes >= 4 ? 'BUY' : bearishVotes >= 4 ? 'SELL' : 'WAIT';
    const vwapSignal = priceAboveVwap && trendBull && volumeOk ? 'BUY' : priceBelowVwap && trendBear && volumeOk ? 'SELL' : 'WAIT';
    return {
      timestamp,
      time: formatTime(timestamp),
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

  parseGrowwNiftyOptionPage(text) {
    const match = text.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (!match) throw new Error('Groww option page did not contain __NEXT_DATA__ option payload');
    const jsonText = match[1]
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
    const payload = JSON.parse(jsonText);
    const data = payload?.props?.pageProps?.data;
    const optionChain = data?.optionChain;
    const contracts = optionChain?.optionContracts || [];
    if (!contracts.length) throw new Error('Groww option chain contracts are empty');
    const previousByStrike = new Map((this.niftyTableSnapshot?.rows || []).map((row) => [row.strike, row]));
    const rows = contracts.map((contract) => {
      const strike = Math.round((Number(contract.strikePrice) || 0) / 100);
      const call = this.optionLegFromGroww(contract.ce);
      const put = this.optionLegFromGroww(contract.pe);
      const prev = previousByStrike.get(strike);
      call.deltaClass = {
        ltp: this.diffClass(call.ltp, prev?.call?.ltp),
        oi: this.diffClass(call.oi, prev?.call?.oi),
        changeOI: this.diffClass(call.changeOI, prev?.call?.changeOI),
        oiPct: this.diffClass(call.oiPct, prev?.call?.oiPct)
      };
      put.deltaClass = {
        ltp: this.diffClass(put.ltp, prev?.put?.ltp),
        oi: this.diffClass(put.oi, prev?.put?.oi),
        changeOI: this.diffClass(put.changeOI, prev?.put?.changeOI),
        oiPct: this.diffClass(put.oiPct, prev?.put?.oiPct)
      };
      return { strike, call, put };
    }).filter((row) => row.strike > 0).sort((a, b) => a.strike - b.strike);
    const company = data?.company || {};
    const spot = Number(company?.liveData?.ltp) || this.getSnapshot().indices.find((idx) => idx.symbol === 'NIFTY50')?.value || 0;
    const timestamp = Date.now();
    const totals = {
      totalCallOI: rows.reduce((acc, row) => acc + row.call.oi, 0),
      totalPutOI: rows.reduce((acc, row) => acc + row.put.oi, 0),
      totalCallChangeOI: rows.reduce((acc, row) => acc + row.call.changeOI, 0),
      totalPutChangeOI: rows.reduce((acc, row) => acc + row.put.changeOI, 0)
    };
    const nearest = rows.reduce((best, row) => Math.abs(row.strike - spot) < Math.abs(best.strike - spot) ? row : best, rows[0]);
    const reading = this.buildNiftyOptionSignal({ totals, spot, timestamp });
    return {
      source: 'Groww public NIFTY option-chain page parsed from __NEXT_DATA__; use official NSE/broker API for exchange-certified data',
      status: this.isIndianMarketSession() ? 'LIVE' : 'MARKET_CLOSED',
      marketOpen: this.isIndianMarketSession(),
      fetchedAt: timestamp,
      fetchedAtIso: new Date(timestamp).toISOString(),
      underlying: 'NIFTY 50',
      expiryLabel: 'Nearest expiry from Groww page',
      spot: round(spot, 2),
      atmStrike: nearest?.strike || Math.round(spot / 50) * 50,
      rows,
      totals,
      reading
    };
  }

  async refreshNiftyOptionTable({ silent = false, force = false } = {}) {
    if (typeof fetch === 'undefined') return false;
    const now = Date.now();
    if (this.niftyTableInFlight || (!force && now - this.lastNiftyTableAttempt < PRICE_REFRESH_MS)) return false;
    this.niftyTableInFlight = true;
    this.lastNiftyTableAttempt = now;
    try {
      const bases = [];
      if (typeof window !== 'undefined' && window.BQ_LIVE_API_BASE) bases.push(String(window.BQ_LIVE_API_BASE).replace(/\/$/, ''));
      if (typeof window !== 'undefined' && window.location?.origin && window.location.origin !== 'null') bases.push(window.location.origin);
      for (const base of [...new Set(bases)]) {
        try {
          const response = await fetch(`${base}/api/options/nifty-table?ts=${Date.now()}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const json = await response.json();
          if (json?.rows?.length) {
            this.niftyTableSnapshot = json;
            return true;
          }
        } catch {}
      }
      const url = `https://groww.in/options/nifty?_=${Date.now()}`;
      const text = await this.fetchTextWithFallback(url, 14000);
      this.niftyTableSnapshot = this.parseGrowwNiftyOptionPage(text);
      return true;
    } catch (error) {
      if (!silent) console.warn('NIFTY option table refresh failed', error);
      return false;
    } finally {
      this.niftyTableInFlight = false;
    }
  }

  buildQuote(state) {
    const { stock, prevClose, candles, sourceQuote } = state;
    const latest = candles[candles.length - 1];
    const dayHigh = sourceQuote?.high ?? Math.max(...candles.map((c) => c.high));
    const dayLow = sourceQuote?.low ?? Math.min(...candles.map((c) => c.low));
    const volume = sourceQuote?.volume ?? candles.reduce((acc, c) => acc + c.volume, 0);
    const ltp = sourceQuote?.ltp ?? latest.close;
    const open = sourceQuote?.open ?? candles[0].open;
    const ts = sourceQuote?.timestamp ?? latest.time ?? this.clock;
    const pc = sourceQuote?.prevClose ?? prevClose;
    const vwapLine = vwap(candles);
    return {
      symbol: stock.symbol,
      name: stock.name,
      sector: stock.sector,
      indices: stock.indices,
      ltp: round(ltp, 2),
      open: round(open, 2),
      high: round(dayHigh, 2),
      low: round(dayLow, 2),
      prevClose: round(pc, 2),
      change: round(ltp - pc, 2),
      changePct: round(((ltp - pc) / pc) * 100, 2),
      volume,
      avgVolume: stock.avgVolume,
      relVolume: round(sourceQuote ? volume / Math.max(1, stock.avgVolume) : relativeVolume(candles), 2),
      peRatio: Number.isFinite(PE_RATIOS[stock.symbol]) ? PE_RATIOS[stock.symbol] : null,
      vwap: round(vwapLine[vwapLine.length - 1], 2),
      timestamp: ts,
      dataStatus: this.status
    };
  }

  buildIndexQuote(state) {
    const { index, prevClose, candles, sourceQuote } = state;
    const latest = candles[candles.length - 1];
    const value = sourceQuote?.ltp ?? latest.close;
    const pc = sourceQuote?.prevClose ?? prevClose;
    const dayHigh = sourceQuote?.high ?? Math.max(...candles.map((c) => c.high));
    const dayLow = sourceQuote?.low ?? Math.min(...candles.map((c) => c.low));
    const change = value - pc;
    const changePct = (change / pc) * 100;
    const shortChange = percentDistance(value, candles[Math.max(0, candles.length - 18)]?.close ?? value);
    const trend = shortChange > 0.25 ? 'Bullish' : shortChange < -0.25 ? 'Bearish' : 'Sideways';
    const technicalSignal = trend === 'Bullish' ? 'BUY' : trend === 'Bearish' ? 'SELL' : 'WAIT';
    return {
      symbol: index.symbol,
      label: index.label,
      value: round(value, index.symbol === 'INDIAVIX' ? 2 : 2),
      change: round(change, 2),
      changePct: round(changePct, 2),
      dayHigh: round(dayHigh, 2),
      dayLow: round(dayLow, 2),
      marketTrend: trend,
      technicalSignal,
      timestamp: sourceQuote?.timestamp ?? latest.time ?? this.clock,
      dataStatus: this.status
    };
  }

  buildSnapshot() {
    const stocks = [...this.stockStates.values()].map((state) => this.buildQuote(state));
    const indices = [...this.indexStates.values()].map((state) => this.buildIndexQuote(state));
    const advances = stocks.filter((s) => s.changePct > 0.05).length;
    const declines = stocks.filter((s) => s.changePct < -0.05).length;
    const unchanged = stocks.length - advances - declines;
    const timestamps = [...stocks.map((s) => s.timestamp), ...indices.map((i) => i.timestamp)].filter(Number.isFinite);
    const dataTimestamp = timestamps.length ? Math.max(...timestamps) : this.clock;
    return {
      status: this.status,
      timestamp: dataTimestamp,
      stocks,
      indices,
      breadth: {
        advances,
        declines,
        unchanged,
        adRatio: declines ? round(advances / declines, 2) : advances || 1
      },
      meta: {
        provider: this.name,
        source: this.liveSnapshot?.source ?? 'Synthetic demo generator',
        mode: this.status,
        freshnessMs: Math.max(0, Date.now() - dataTimestamp),
        universeSize: stocks.length,
        avgRelVolume: round(average(stocks.map((s) => s.relVolume)), 2),
        validation: this.liveSnapshot?.validation ?? null,
        refreshIntervalMs: PRICE_REFRESH_MS,
        fetchedAt: this.liveSnapshot?.fetchedAt || Date.now(),
        fetchedAtIso: this.liveSnapshot?.fetchedAtIso || new Date().toISOString(),
        refreshPolicy: this.isIndianMarketSession() ? 'Market hours 09:00-15:00 IST: price refresh attempts every 1 second; overlapping calls are skipped.' : 'Market closed: last available data shown; background refresh is slowed.'
      }
    };
  }
}
