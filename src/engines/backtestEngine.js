import { analyzeStock } from './signalEngine.js';
import { round } from '../core/utils.js';

export class SignalJournal {
  constructor(storageKey = 'bq_signal_journal_v1') {
    this.storageKey = storageKey;
    this.rows = this.load();
  }

  load() {
    try { return JSON.parse(localStorage.getItem(this.storageKey) || '[]'); }
    catch { return []; }
  }

  save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.rows.slice(-300)));
    } catch {
      // Arena's preview iframe may run with an opaque origin where localStorage
      // is blocked. Keep the in-memory journal working instead of crashing.
    }
  }

  record(analysis, source = 'DEMO') {
    if (!analysis || !['STRONG BUY', 'BUY', 'STRONG SELL', 'SELL'].includes(analysis.signal)) return;
    const last = [...this.rows].reverse().find((r) => r.symbol === analysis.symbol && r.signal === analysis.signal);
    if (last && Math.abs(analysis.timestamp - last.timestamp) < 20 * 60 * 1000) return;
    this.rows.push({
      id: `${analysis.symbol}-${analysis.timestamp}-${analysis.signal}`,
      symbol: analysis.symbol,
      signal: analysis.signal,
      timestamp: analysis.timestamp,
      entry: analysis.quote.ltp,
      stopLoss: analysis.riskPlan.standardStop,
      targets: [analysis.riskPlan.target1, analysis.riskPlan.target2, analysis.riskPlan.target3],
      confidence: analysis.confidence,
      indicators: analysis.items.filter((i) => Math.abs(i.score) > 0.42).map((i) => i.name),
      result: 'Pending',
      source
    });
    this.save();
  }

  clear() {
    this.rows = [];
    this.save();
  }

  list() {
    return [...this.rows].reverse();
  }
}

/**
 * Demo-only backtest over simulated candles. It demonstrates capability but is
 * not real historical performance and must not be presented as such.
 */
export function runDemoBacktest({ quote, candles, marketRegime, timeframe = '5m' }) {
  const trades = [];
  const lookback = 80;
  for (let i = 65; i < candles.length - 10; i += 6) {
    const window = candles.slice(Math.max(0, i - lookback), i + 1);
    const q = { ...quote, ltp: candles[i].close, high: candles[i].high, low: candles[i].low, volume: candles[i].volume, timestamp: candles[i].time };
    const analysis = analyzeStock({ quote: q, candles: window, marketRegime, dataStatus: 'DEMO', timeframe });
    if (!['STRONG BUY', 'BUY', 'STRONG SELL', 'SELL'].includes(analysis.signal)) continue;
    const forward = candles.slice(i + 1, Math.min(candles.length, i + 18));
    if (!forward.length) continue;
    const side = analysis.signal.includes('BUY') ? 'BUY' : 'SELL';
    let outcome = 'Open';
    let exit = forward[forward.length - 1].close;
    for (const c of forward) {
      if (side === 'BUY') {
        if (c.low <= analysis.riskPlan.standardStop) { outcome = 'Loss'; exit = analysis.riskPlan.standardStop; break; }
        if (c.high >= analysis.riskPlan.target1) { outcome = 'Win'; exit = analysis.riskPlan.target1; break; }
      } else {
        if (c.high >= analysis.riskPlan.standardStop) { outcome = 'Loss'; exit = analysis.riskPlan.standardStop; break; }
        if (c.low <= analysis.riskPlan.target1) { outcome = 'Win'; exit = analysis.riskPlan.target1; break; }
      }
    }
    const ret = side === 'BUY' ? ((exit - q.ltp) / q.ltp) * 100 : ((q.ltp - exit) / q.ltp) * 100;
    trades.push({ symbol: quote.symbol, signal: analysis.signal, entry: q.ltp, exit, result: outcome, returnPct: ret, confidence: analysis.confidence, time: q.timestamp });
  }
  const closed = trades.filter((t) => t.result !== 'Open');
  const wins = closed.filter((t) => t.result === 'Win').length;
  const losses = closed.filter((t) => t.result === 'Loss').length;
  const avgReturn = closed.length ? closed.reduce((a, t) => a + t.returnPct, 0) / closed.length : 0;
  const grossProfit = closed.filter((t) => t.returnPct > 0).reduce((a, t) => a + t.returnPct, 0);
  const grossLoss = Math.abs(closed.filter((t) => t.returnPct < 0).reduce((a, t) => a + t.returnPct, 0));
  let equity = 0;
  let peak = 0;
  let maxDD = 0;
  for (const t of closed) {
    equity += t.returnPct;
    peak = Math.max(peak, equity);
    maxDD = Math.min(maxDD, equity - peak);
  }
  return {
    label: 'DEMO SIMULATION ONLY — not real historical performance',
    totalSignals: trades.length,
    closedSignals: closed.length,
    wins,
    losses,
    winRate: closed.length ? round((wins / closed.length) * 100, 1) : null,
    averageReturn: round(avgReturn, 2),
    profitFactor: grossLoss ? round(grossProfit / grossLoss, 2) : null,
    maxDrawdown: round(maxDD, 2),
    trades: trades.slice(-20).reverse()
  };
}
