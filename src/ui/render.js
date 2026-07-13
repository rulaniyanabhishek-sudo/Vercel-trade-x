import { DISCLAIMER } from '../data/universe.js';
import { directionClass, formatCompact, formatDateTime, formatINR, formatNumber, formatPct, formatTime, signalClass } from '../core/utils.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

export function signalBadge(signal) {
  return `<span class="signal-badge ${signalClass(signal)}">${esc(signal)}</span>`;
}

export function confidenceBar(confidence, bearish = false) {
  return `<span class="conf-bar" title="Confidence ${confidence}/100"><span class="conf-fill ${bearish ? 'red' : ''}" style="width:${Math.max(4, Math.min(100, confidence))}%"></span></span> <span class="num tiny">${confidence}</span>`;
}

export function dataPill(status) {
  const s = String(status || 'DEMO').toLowerCase();
  return `<span class="pill pill-dot ${s}">${esc(status)}</span>`;
}

export function changeHtml(value, pct = null) {
  const cls = directionClass(value);
  return `<span class="num ${cls}">${value > 0 ? '+' : ''}${formatNumber(value, 2)}${pct !== null ? ` (${formatPct(pct)})` : ''}</span>`;
}

export function money(value, digits = 2) {
  return `<span class="num">${formatINR(value, digits)}</span>`;
}

export function number(value, digits = 0) {
  return `<span class="num">${formatNumber(value, digits)}</span>`;
}

export function compact(value) {
  return `<span class="num">${formatCompact(value)}</span>`;
}

export function pageHeader(title, subtitle, actions = '') {
  return `<div class="page-header"><div class="page-title"><h2>${esc(title)}</h2><p>${subtitle}</p></div><div class="toolbar">${actions}</div></div>`;
}

export function disclaimer() {
  return `<div class="footer-note">${esc(DISCLAIMER)} Every signal displays confidence, reasons, risks, invalidation and timestamp. No guaranteed profits are implied.</div>`;
}

export function miniSparkline(values, color = '#00d48a') {
  if (!values?.length) return '';
  const width = 96;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((v, i) => {
    const x = (i / Math.max(1, values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg class="mini-chart" viewBox="0 0 ${width} ${height}" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2.2" points="${points}"/><linearGradient id="g${Math.random().toString(36).slice(2)}"></linearGradient></svg>`;
}

export function indexCard(index, candles = []) {
  const values = candles.slice(-34).map((c) => c.close);
  const positive = index.change >= 0;
  return `<div class="card metric-card">
    <div class="metric-top">
      <div><div class="metric-label">${esc(index.label)}</div><div class="metric-value num">${formatNumber(index.value, index.symbol === 'INDIAVIX' ? 2 : 2)}</div></div>
      ${miniSparkline(values, positive ? '#00d48a' : '#ff4d5e')}
    </div>
    ${changeHtml(index.change, index.changePct)}
    <div class="metric-meta">
      <span>H ${formatNumber(index.dayHigh, 2)}</span><span>L ${formatNumber(index.dayLow, 2)}</span><span>${esc(index.marketTrend)}</span>${signalBadge(index.technicalSignal)}
    </div>
  </div>`;
}

export function stockSymbolCell(stock, watched = false) {
  const initials = stock.symbol.replace(/[^A-Z]/g, '').slice(0, 3);
  return `<div class="symbol-cell">
    <button class="star-btn ${watched ? 'active' : ''}" data-action="watch" data-symbol="${esc(stock.symbol)}" title="Toggle watchlist">★</button>
    <div class="symbol-avatar">${esc(initials)}</div>
    <div class="symbol-main"><b>${esc(stock.symbol)}</b><span>${esc(stock.name)}</span></div>
  </div>`;
}

export function qualityChips(checks = []) {
  return `<div class="quality-grid">${checks.map((c) => `<div class="quality-chip ${c.state}"><b>${esc(c.label)}</b><br><span>${esc(c.text)}</span></div>`).join('')}</div>`;
}

export function formatTimestamp(ts) {
  return `<span class="num tiny">${formatDateTime(ts)}</span>`;
}

export { formatTime, formatDateTime, formatINR, formatNumber, formatPct, formatCompact };
