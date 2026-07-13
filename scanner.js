import { TIMEFRAMES } from '../data/universe.js';
import { analyzeStock } from '../engines/signalEngine.js';
import { compact, confidenceBar, dataPill, money, pageHeader, signalBadge, stockSymbolCell, formatNumber, formatDateTime } from '../ui/render.js';

export function renderScanner(state, provider) {
  const timeframe = state.scannerTimeframe || '15m';
  const cacheOk = state.scannerCache
    && state.scannerCache.timeframe === timeframe
    && Date.now() - state.scannerCache.createdAt < 5000;
  const baseAnalyses = cacheOk ? state.scannerCache.analyses : state.snapshot.stocks.map((quote) => analyzeStock({
    quote,
    candles: provider.getCandles(quote.symbol, timeframe),
    marketRegime: state.marketRegime,
    dataStatus: state.snapshot.status,
    timeframe
  })).sort((a, b) => Math.abs(b.score) - Math.abs(a.score));
  if (!cacheOk) state.scannerCache = { timeframe, createdAt: Date.now(), analyses: baseAnalyses };
  const watchedOrder = [...(state.watchlist || new Set())];
  const analyses = watchedOrder.length
    ? [...baseAnalyses].sort((a, b) => {
      const ai = watchedOrder.indexOf(a.symbol);
      const bi = watchedOrder.indexOf(b.symbol);
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 999999 : ai) - (bi === -1 ? 999999 : bi);
      return 0;
    })
    : baseAnalyses;

  const tfButtons = TIMEFRAMES.map((tf) => `<button class="button ${timeframe === tf.id ? 'active' : ''}" data-action="scanner-timeframe" data-timeframe="${tf.id}">${tf.id}</button>`).join('');
  const marketPcr = state.niftyTable?.reading?.pcr ?? state.options?.totals?.pcr ?? null;
  const rows = analyses.map((a) => {
    const i = a.indicators;
    const rp = a.riskPlan || {};
    const macd = i.macdHist > 0 ? 'Bullish' : i.macdHist < 0 ? 'Bearish' : 'Flat';
    const cloud = a.quote.ltp > Math.max(i.ichimokuSpanA || a.quote.ltp, i.ichimokuSpanB || a.quote.ltp) ? 'Above cloud' : a.quote.ltp < Math.min(i.ichimokuSpanA || a.quote.ltp, i.ichimokuSpanB || a.quote.ltp) ? 'Below cloud' : 'Inside cloud';
    const pivotZone = a.quote.ltp > i.pivots.r1 ? 'Above R1' : a.quote.ltp < i.pivots.s1 ? 'Below S1' : 'Pivot range';
    const watched = state.watchlist?.has(a.symbol);
    const direction = a.signal.includes('BUY') ? 1 : a.signal.includes('SELL') ? -1 : 0;
    const agree = direction ? a.items.filter((item) => Math.sign(item.score) === direction && Math.abs(item.score) >= 0.25).length : 0;
    const pcrText = Number.isFinite(marketPcr) ? formatNumber(marketPcr, 2) : '—';
    const pcrClass = Number.isFinite(marketPcr) ? (marketPcr > 1 ? 'pos' : marketPcr < 1 ? 'neg' : 'muted') : 'muted';
    return `<tr class="row-click ${watched ? 'pinned-row' : ''}" data-action="open-stock" data-symbol="${a.symbol}">
      <td>${stockSymbolCell(a.quote, watched)}</td><td>${money(a.quote.ltp)}</td><td>${signalBadge(a.signal)}</td><td>${confidenceBar(a.confidence, a.signal.includes('SELL'))}</td>
      <td><span class="num ${pcrClass}">${pcrText}</span><br><span class="muted tiny">NIFTY PCR</span></td>
      <td>${rp.entryLow ? `${money(rp.entryLow)} – ${money(rp.entryHigh)}` : '<span class="muted">—</span>'}</td>
      <td>${rp.standardStop ? money(rp.standardStop) : '<span class="muted">—</span>'}</td>
      <td>${rp.target1 ? `${money(rp.target1)} / ${money(rp.target2)}` : '<span class="muted">—</span>'}</td>
      <td><span class="num ${agree >= 7 ? 'pos' : agree >= 5 ? 'warning' : 'muted'}">${agree}/10</span></td>
      <td><span class="num ${i.rsi > 70 ? 'neg' : i.rsi < 30 ? 'pos' : ''}">${formatNumber(i.rsi, 1)}</span></td>
      <td><span class="${macd === 'Bullish' ? 'pos' : macd === 'Bearish' ? 'neg' : 'muted'}">${macd}</span></td>
      <td>${cloud}</td><td>${pivotZone}</td><td><span class="${i.supertrendDirection === 'BULLISH' ? 'pos' : 'neg'}">${i.supertrendDirection}</span></td>
      <td><span class="num">${formatNumber(i.bbWidth, 2)}%</span></td><td>${money(i.vwap)}</td><td>${money(i.ema20)} / ${money(i.sma50)}</td>
      <td><span class="num ${i.adx >= 22 ? 'pos' : 'muted'}">${formatNumber(i.adx, 1)}</span></td><td>${money(i.atr)}</td><td><span class="num">${formatNumber(i.stochK, 1)}</span></td>
      <td><span class="num ${a.quote.relVolume >= 1.15 ? 'pos' : a.quote.relVolume < .75 ? 'neg' : ''}">${formatNumber(a.quote.relVolume, 2)}x</span></td><td>${compact(a.quote.volume)}</td><td>${formatDateTime(a.timestamp)}</td>
    </tr>`;
  }).join('');
  return `${pageHeader('Technical Scanner', `Multi-timeframe scanner for NIFTY 50 and SENSEX stocks. It uses RSI, MACD, Ichimoku, pivots, Supertrend, Bollinger Bands, VWAP, EMA/SMA, ADX, ATR, Stochastic RSI and volume—not one-indicator shortcuts.`, `<div class="toolbar">${tfButtons}</div>`)}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px"><div>${dataPill(state.snapshot.status)} <span class="pill info">Timeframe ${timeframe}</span> <span class="pill warning">Weights adapt to ${state.marketRegime.trend}</span></div></div>
    <div class="card">
      <div class="card-header"><div><h3 class="card-title">Indicator Consensus Table</h3><p class="card-subtitle">Starred watchlist stocks stay pinned at the top; the rest are sorted by absolute signal score. Weak/conflicting readings remain WAIT or NO TRADE.</p></div></div>
      <div style="padding:16px"><div class="table-wrap"><table>
        <thead><tr><th>Stock</th><th>LTP</th><th>Signal</th><th>Confidence</th><th>PCR</th><th>Entry Price</th><th>Stop Loss</th><th>Targets</th><th>Agree</th><th>RSI</th><th>MACD</th><th>Ichimoku</th><th>Pivot</th><th>Supertrend</th><th>BB Width</th><th>VWAP</th><th>EMA20 / SMA50</th><th>ADX</th><th>ATR</th><th>Stoch RSI</th><th>Rel Vol</th><th>Volume</th><th>Updated</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div></div>
    </div>`;
}
