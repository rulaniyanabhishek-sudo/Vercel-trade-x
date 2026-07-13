export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function round(value, digits = 2) {
  if (!Number.isFinite(value)) return 0;
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

export function seededRandom(seed) {
  let state = seed >>> 0;
  return function rand() {
    state += 0x6D2B79F5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function normalish(rand) {
  return (rand() + rand() + rand() + rand() - 2) / 2;
}

export function formatTime(ts) {
  return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
}

export function formatDateTime(ts) {
  return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(ts));
}

export function formatINR(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatNumber(value, digits = 0) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(value);
}

export function formatCompact(value) {
  if (!Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 2 }).format(value);
}

export function formatPct(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(digits)}%`;
}

export function signalClass(signal = '') {
  return `sig-${String(signal).toLowerCase().replace(/\s+/g, '-')}`;
}

export function directionClass(value) {
  return value > 0 ? 'pos' : value < 0 ? 'neg' : 'muted';
}

export function safeId(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '_');
}

export function average(values) {
  const arr = values.filter(Number.isFinite);
  return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

export function sum(values) {
  return values.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
}

export function last(values, fallback = null) {
  if (!values?.length) return fallback;
  for (let i = values.length - 1; i >= 0; i -= 1) {
    if (values[i] !== null && values[i] !== undefined && Number.isFinite(values[i])) return values[i];
  }
  return fallback;
}

export function percentDistance(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return ((a - b) / b) * 100;
}

export function uniqBy(arr, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const key = keyFn(item);
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
