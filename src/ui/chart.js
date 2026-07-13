import { buildIndicatorSnapshot } from '../engines/indicators.js';

function resizeCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width * ratio));
  canvas.height = Math.max(220, Math.floor(rect.height * ratio));
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function drawLine(ctx, values, candles, scale, color, width = 1.6) {
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  let started = false;
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) return;
    const x = scale.x(i);
    const y = scale.y(v);
    if (!started) { ctx.moveTo(x, y); started = true; }
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

export function drawCandlestickChart(canvas, candles, analysis) {
  if (!canvas || !candles?.length) return;
  const { ctx, width, height } = resizeCanvas(canvas);
  const pad = { left: 52, right: 16, top: 18, bottom: 34 };
  ctx.clearRect(0, 0, width, height);
  const visible = candles.slice(-120);
  const indicators = analysis?.indicators ?? buildIndicatorSnapshot(visible);
  const lineValues = [
    ...(indicators.raw?.vwapLine?.slice(-visible.length) ?? []),
    ...(indicators.raw?.ema20?.slice(-visible.length) ?? []),
    ...(indicators.raw?.ema50?.slice(-visible.length) ?? []),
    ...visible.flatMap((c) => [c.high, c.low])
  ].filter(Number.isFinite);
  const min = Math.min(...lineValues);
  const max = Math.max(...lineValues);
  const range = max - min || 1;
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;
  const scale = {
    x: (i) => pad.left + (i / Math.max(1, visible.length - 1)) * chartW,
    y: (v) => pad.top + ((max - v) / range) * chartH
  };

  ctx.fillStyle = '#07101b';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(148, 163, 184, .11)';
  ctx.lineWidth = 1;
  ctx.font = '11px ui-monospace, SFMono-Regular, Consolas, monospace';
  ctx.fillStyle = '#8795aa';
  for (let i = 0; i <= 5; i += 1) {
    const y = pad.top + (chartH / 5) * i;
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    const price = max - (range / 5) * i;
    ctx.fillText(price.toFixed(2), 6, y + 4);
  }

  const candleW = Math.max(3, Math.min(10, chartW / visible.length * 0.62));
  visible.forEach((c, i) => {
    const x = scale.x(i);
    const openY = scale.y(c.open);
    const closeY = scale.y(c.close);
    const highY = scale.y(c.high);
    const lowY = scale.y(c.low);
    const up = c.close >= c.open;
    ctx.strokeStyle = up ? '#00d48a' : '#ff4d5e';
    ctx.fillStyle = up ? 'rgba(0, 212, 138, .86)' : 'rgba(255, 77, 94, .88)';
    ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();
    const bodyY = Math.min(openY, closeY);
    const bodyH = Math.max(1.5, Math.abs(closeY - openY));
    ctx.fillRect(x - candleW / 2, bodyY, candleW, bodyH);
  });

  if (indicators.raw?.vwapLine) drawLine(ctx, indicators.raw.vwapLine.slice(-visible.length), visible, scale, '#5aa7ff', 1.8);
  if (indicators.raw?.ema20) drawLine(ctx, indicators.raw.ema20.slice(-visible.length), visible, scale, '#f5b84b', 1.4);
  if (indicators.raw?.ema50) drawLine(ctx, indicators.raw.ema50.slice(-visible.length), visible, scale, '#a78bfa', 1.3);

  const levels = [
    ...(indicators.supports || []).filter((s) => s.price >= min && s.price <= max).slice(0, 3).map((s) => ({ ...s, color: 'rgba(0, 212, 138, .55)', label: `S ${s.price.toFixed(2)}` })),
    ...(indicators.resistances || []).filter((r) => r.price >= min && r.price <= max).slice(0, 3).map((r) => ({ ...r, color: 'rgba(255, 77, 94, .55)', label: `R ${r.price.toFixed(2)}` }))
  ];
  levels.forEach((l) => {
    const y = scale.y(l.price);
    ctx.strokeStyle = l.color;
    ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(width - pad.right, y); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = l.color;
    ctx.fillText(l.label, width - pad.right - 72, y - 5);
  });

  ctx.fillStyle = '#dce8f8';
  ctx.font = '12px Inter, sans-serif';
  ctx.fillText(`${analysis?.symbol ?? ''} · Candles + VWAP (blue) · EMA20 (amber) · EMA50 (purple)`, pad.left, height - 12);
}
