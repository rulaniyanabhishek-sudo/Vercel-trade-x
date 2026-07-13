import { writeFileSync } from 'node:fs';
import { DemoMarketDataProvider } from '../src/providers/demoMarketDataProvider.js';
import { detectMarketRegime } from '../src/engines/marketRegime.js';
import { analyzeStock } from '../src/engines/signalEngine.js';
import { isIndianMarketSession } from '../server/live-data-service.mjs';

const provider = new DemoMarketDataProvider();
const snapshot = provider.getSnapshot();
const regime = detectMarketRegime(snapshot);
const quote = snapshot.stocks.find((s) => s.symbol === 'RELIANCE');
const timeframes = ['1m', '5m', '15m', '30m', '1h', '1d', '1w'].map((timeframe) => {
  const candles = provider.getCandles('RELIANCE', timeframe);
  const analysis = analyzeStock({ quote, candles, marketRegime: regime, dataStatus: snapshot.status, timeframe });
  return {
    timeframe,
    candles: candles.length,
    signal: analysis.signal,
    score: analysis.score,
    confidence: analysis.confidence,
    ok: candles.length > 0 && Number.isFinite(analysis.score) && Number.isFinite(analysis.confidence) && !!analysis.signal
  };
});

const probes = [
  ['tomorrow_10am_ist', '2026-07-11T10:00:00+05:30'],
  ['next_monday_10am_ist', '2026-07-13T10:00:00+05:30'],
  ['next_monday_2_30pm_ist', '2026-07-13T14:30:00+05:30'],
  ['next_monday_4pm_ist', '2026-07-13T16:00:00+05:30']
].map(([label, iso]) => ({ label, iso, marketSessionOpen: isIndianMarketSession(new Date(iso)) }));

const report = {
  generatedAt: new Date().toISOString(),
  note: 'Tomorrow relative to 2026-07-10 IST is Saturday, so live market refresh should correctly remain closed/delayed. Next Monday probes should be open during 09:00-15:00 IST.',
  dataStatusNow: snapshot.status,
  marketSessionProbes: probes,
  timeframeAnalysis: timeframes,
  ok: timeframes.every((x) => x.ok) && probes.find((p) => p.label === 'tomorrow_10am_ist')?.marketSessionOpen === false && probes.find((p) => p.label === 'next_monday_10am_ist')?.marketSessionOpen === true
};

writeFileSync('live-readiness-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
