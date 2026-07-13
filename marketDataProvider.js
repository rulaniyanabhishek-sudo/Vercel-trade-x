/**
 * Provider-agnostic market data contract.
 *
 * Production implementations should keep credentials server-side and stream
 * sanitized market snapshots to the browser via REST/WebSocket.
 */
export class MarketDataProvider {
  constructor(name = 'abstract') {
    this.name = name;
    this.status = 'DISCONNECTED';
  }

  async connect() {
    throw new Error('connect() must be implemented by a concrete provider.');
  }

  disconnect() {
    throw new Error('disconnect() must be implemented by a concrete provider.');
  }

  subscribe(_callback) {
    throw new Error('subscribe(callback) must be implemented by a concrete provider.');
  }

  getSnapshot() {
    throw new Error('getSnapshot() must be implemented by a concrete provider.');
  }

  getCandles(_symbol, _timeframe = '5m') {
    throw new Error('getCandles(symbol, timeframe) must be implemented by a concrete provider.');
  }

  getIndexCandles(_symbol, _timeframe = '5m') {
    throw new Error('getIndexCandles(symbol, timeframe) must be implemented by a concrete provider.');
  }

  getOptionsChain(_instrument = 'NIFTY') {
    throw new Error('getOptionsChain(instrument) must be implemented by a concrete provider.');
  }
}

export class OfficialProviderAdapter extends MarketDataProvider {
  constructor() {
    super('OfficialProviderAdapter');
    this.status = 'NOT_CONFIGURED';
  }

  async connect() {
    this.status = 'NOT_CONFIGURED';
    throw new Error('No licensed market data credentials are configured. Use a server-side implementation with env vars.');
  }
}
