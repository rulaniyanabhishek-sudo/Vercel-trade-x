import { dataPill, money, pageHeader, signalBadge, formatDateTime, formatNumber } from '../ui/render.js';

function journalTable(rows) {
  const body = rows.map((r) => `<tr><td>${r.symbol}</td><td>${signalBadge(r.signal)}</td><td>${formatDateTime(r.timestamp)}</td><td>${money(r.entry)}</td><td>${money(r.stopLoss)}</td><td>${r.targets.map((t) => money(t)).join(' / ')}</td><td class="num">${r.confidence}</td><td>${r.indicators.join(', ')}</td><td><span class="pill warning">${r.result}</span></td><td>${r.source}</td></tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr><th>Stock</th><th>Signal</th><th>Timestamp</th><th>Entry</th><th>Stop-loss</th><th>Targets</th><th>Confidence</th><th>Indicators used</th><th>Result</th><th>Source</th></tr></thead><tbody>${body || '<tr><td colspan="10"><div class="empty-state">No session signals stored yet. Strong BUY/SELL demo signals are journaled automatically.</div></td></tr>'}</tbody></table></div>`;
}

function demoBacktestCard(bt) {
  if (!bt) return `<div class="warning-panel"><b>Insufficient historical data</b><br>Real win rate, profit factor and drawdown require licensed historical candles and completed trade outcomes. Use the button to run a clearly-labelled demo simulation on simulated candles only.</div>`;
  const rows = bt.trades.map((t) => `<tr><td>${formatDateTime(t.time)}</td><td>${signalBadge(t.signal)}</td><td>${money(t.entry)}</td><td>${money(t.exit)}</td><td><span class="pill ${t.result === 'Win' ? 'positive' : t.result === 'Loss' ? 'negative' : 'warning'}">${t.result}</span></td><td><span class="num ${t.returnPct >= 0 ? 'pos' : 'neg'}">${formatNumber(t.returnPct, 2)}%</span></td><td class="num">${t.confidence}</td></tr>`).join('');
  return `<div class="card pad"><div class="warning-panel"><b>${bt.label}</b><br>These numbers are generated from simulated candles and must not be interpreted as real strategy performance.</div>
    <div class="kpi-row" style="margin-top:12px"><div class="kpi"><span>Total signals</span><b>${bt.totalSignals}</b></div><div class="kpi"><span>Win rate</span><b>${bt.winRate === null ? '—' : `${bt.winRate}%`}</b></div><div class="kpi"><span>Avg return</span><b>${bt.averageReturn}%</b></div><div class="kpi"><span>Profit factor</span><b>${bt.profitFactor ?? '—'}</b></div></div>
    <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Time</th><th>Signal</th><th>Entry</th><th>Exit</th><th>Result</th><th>Return</th><th>Confidence</th></tr></thead><tbody>${rows || '<tr><td colspan="7">No demo trades triggered.</td></tr>'}</tbody></table></div>
  </div>`;
}

export function renderPerformance(state) {
  const journalRows = state.journalRows || [];
  return `${pageHeader('Signal Performance', `Stores every generated signal with entry, stop, targets, confidence and indicators used. The app never displays a real win rate unless real historical testing has been performed.`, `<button class="button primary" data-action="run-demo-backtest">Run Demo Backtest</button><button class="button danger" data-action="clear-journal">Clear Journal</button>`)}
    <div class="toolbar" style="justify-content:space-between;margin-bottom:14px"><div>${dataPill(state.snapshot.status)} <span class="pill warning">Real performance: Insufficient historical data</span> <span class="pill info">Journal rows ${journalRows.length}</span></div></div>
    <div class="grid cols-4" style="margin-bottom:14px">
      <div class="card pad"><div class="metric-label">Total Signals</div><div class="metric-value num">${journalRows.length}</div></div>
      <div class="card pad"><div class="metric-label">Win Rate</div><div class="metric-value">Insufficient data</div></div>
      <div class="card pad"><div class="metric-label">Profit Factor</div><div class="metric-value">Insufficient data</div></div>
      <div class="card pad"><div class="metric-label">Max Drawdown</div><div class="metric-value">Insufficient data</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="card-header"><div><h3 class="card-title">Historical Signal Journal</h3><p class="card-subtitle">Pending results until real market outcomes are available.</p></div></div><div style="padding:16px">${journalTable(journalRows)}</div></div>
    ${demoBacktestCard(state.demoBacktest)}`;
}
