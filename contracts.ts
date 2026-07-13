// TypeScript contracts for production implementation. The preview app uses
// dependency-free ES modules, but these interfaces map directly to a React/Next
// + Node service architecture.

export type DataStatus = 'LIVE' | 'DELAYED' | 'DEMO' | 'STALE';
export type Signal = 'STRONG BUY' | 'BUY' | 'WEAK BUY' | 'WAIT' | 'NEUTRAL' | 'NO TRADE' | 'WEAK SELL' | 'SELL' | 'STRONG SELL';

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Quote {
  symbol: string;
  name: string;
  ltp: number;
  change: number;
  changePct: number;
  open: number;
  high: number;
  low: number;
  prevClose: number;
  volume: number;
  relVolume: number;
  vwap: number;
  timestamp: number;
  dataStatus: DataStatus;
}

export interface MarketSnapshot {
  status: DataStatus;
  timestamp: number;
  stocks: Quote[];
  indices: IndexQuote[];
}

export interface IndexQuote {
  symbol: 'NIFTY50' | 'SENSEX' | 'BANKNIFTY' | 'INDIAVIX';
  label: string;
  value: number;
  change: number;
  changePct: number;
  dayHigh: number;
  dayLow: number;
  marketTrend: string;
  technicalSignal: Signal | 'BUY' | 'SELL';
  timestamp: number;
  dataStatus: DataStatus;
}

export interface MarketDataProvider {
  connect(): Promise<MarketSnapshot>;
  disconnect(): void;
  subscribe(callback: (snapshot: MarketSnapshot) => void): () => void;
  getSnapshot(): MarketSnapshot;
  getCandles(symbol: string, timeframe: string): Candle[];
  getIndexCandles(symbol: string, timeframe: string): Candle[];
}

export interface OptionsDataProvider {
  getOptionsChain(instrument: 'NIFTY' | 'BANKNIFTY', expiry?: string): Promise<OptionChain>;
}

export interface HistoricalDataProvider {
  getHistoricalCandles(symbol: string, timeframe: string, from: string, to: string): Promise<Candle[]>;
}

export interface OptionLeg {
  ltp: number;
  oi: number;
  changeOI: number;
  oiPctChange: number;
  volume: number;
  iv: number;
}

export interface OptionChainRow {
  strike: number;
  call: OptionLeg;
  put: OptionLeg;
  isATM: boolean;
}

export interface OptionChain {
  instrument: 'NIFTY' | 'BANKNIFTY';
  spot: number;
  atm: number;
  timestamp: number;
  rows: OptionChainRow[];
}

export interface RiskPlan {
  entryLow: number | null;
  entryHigh: number | null;
  conservativeStop: number | null;
  standardStop: number | null;
  aggressiveStop: number | null;
  target1: number | null;
  target2: number | null;
  target3: number | null;
  rr: number;
  invalidation: number | null;
  riskLevel: 'Controlled' | 'Medium' | 'High';
}

export interface GeneratedSignal {
  symbol: string;
  signal: Signal;
  score: number;
  confidence: number;
  evidence: string[];
  conflicts: string[];
  warnings: string[];
  riskPlan: RiskPlan;
  timestamp: number;
  timeframe: string;
  dataStatus: DataStatus;
}
