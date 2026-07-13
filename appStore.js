import { SignalJournal } from '../engines/backtestEngine.js';

const DEFAULT_WATCHLIST = ['RELIANCE', 'HDFCBANK', 'ICICIBANK', 'INFY', 'TCS'];

export class AppStore {
  constructor() {
    this.state = {
      route: 'dashboard',
      selectedSymbol: 'RELIANCE',
      timeframe: '5m',
      dashboardTab: 'all',
      scannerTimeframe: '15m',
      search: '',
      sortKey: 'changePct',
      sortDir: 'desc',
      optionsInstrument: 'NIFTY',
      tableTimeframe: 5,
      tableSearch: '',
      tableSort: { side: 'call', key: 'strike', dir: 'asc' },
      niftyTable: null,
      niftyTableHistory: [],
      watchlist: this.loadSet('bq_watchlist_v1', DEFAULT_WATCHLIST),
      alerts: this.loadAlerts(),
      snapshot: null,
      marketRegime: null,
      analyses: [],
      options: null,
      optionsHistory: this.loadJson('bq_options_history_v1', { NIFTY: [], BANKNIFTY: [] }),
      demoBacktest: null,
      settings: this.loadJson('bq_settings_v1', { minRR: 1.5, refreshMs: 2600, staleSeconds: 15 }),
      sidebarCollapsed: this.loadJson('bq_sidebar_collapsed_v1', false)
    };
    this.journal = new SignalJournal();
  }

  loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
    catch { return fallback; }
  }

  saveJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // In sandboxed previews localStorage can be unavailable. The app should
      // continue with in-memory settings/watchlists instead of remaining stuck.
    }
  }

  loadSet(key, fallback = []) {
    const values = this.loadJson(key, fallback);
    return new Set(values?.length ? values : fallback);
  }

  saveWatchlist() {
    this.saveJson('bq_watchlist_v1', [...this.state.watchlist]);
  }

  loadAlerts() {
    return this.loadJson('bq_alerts_v1', [
      { id: 'demo-1', symbol: 'RELIANCE', condition: 'Signal turns STRONG BUY', status: 'Demo armed' },
      { id: 'demo-2', symbol: 'NIFTY', condition: 'PCR/VWAP conflict clears', status: 'Demo armed' }
    ]);
  }

  set(partial) {
    Object.assign(this.state, partial);
  }

  toggleWatchlist(symbol) {
    if (this.state.watchlist.has(symbol)) this.state.watchlist.delete(symbol);
    else this.state.watchlist.add(symbol);
    this.saveWatchlist();
  }

  addOptionsReading(instrument, reading) {
    const history = this.state.optionsHistory[instrument] ?? [];
    const last = history[history.length - 1];
    if (!last || last.time !== reading.time) {
      history.push(reading);
      this.state.optionsHistory[instrument] = history.slice(-80);
      this.saveJson('bq_options_history_v1', this.state.optionsHistory);
    }
  }

  addNiftyTableReading(reading) {
    if (!reading) return;
    const history = this.state.niftyTableHistory ?? [];
    const last = history[history.length - 1];
    if (!last || last.timestamp !== reading.timestamp) {
      history.push(reading);
      this.state.niftyTableHistory = history.slice(-900);
    }
  }

  setSidebarCollapsed(collapsed) {
    this.state.sidebarCollapsed = !!collapsed;
    this.saveJson('bq_sidebar_collapsed_v1', this.state.sidebarCollapsed);
  }

  clearJournal() {
    this.journal.clear();
  }
}
