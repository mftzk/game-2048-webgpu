import { tileColor } from "../webgpu/pipelines.js";

const DIGITS = [
  [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
];

function rgbStr(rgb, alpha = 1) {
  const r = Math.round(rgb[0] * 255);
  const g = Math.round(rgb[1] * 255);
  const b = Math.round(rgb[2] * 255);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function digitCount(value) {
  if (value >= 100000) return 6;
  if (value >= 10000) return 5;
  if (value >= 1000) return 4;
  if (value >= 100) return 3;
  if (value >= 10) return 2;
  return 1;
}

function drawDigits(ctx, value, x, y, cell) {
  const n = digitCount(value);
  const availW = cell * 0.82;
  const availH = cell * 0.52;
  const totalUnitsW = n * 6 - 1;
  const unit = Math.min(availH / 7, availW / totalUnitsW);
  const totalW = unit * totalUnitsW;
  const totalH = unit * 7;
  const startX = x + (cell - totalW) / 2;
  const startY = y + (cell - totalH) / 2;
  ctx.fillStyle = value <= 16 ? "#2B2118" : "#FFFFFF";
  for (let d = 0; d < n; d += 1) {
    const place = n - 1 - d;
    const digit = Math.floor(value / 10 ** place) % 10;
    const rows = DIGITS[digit];
    for (let row = 0; row < 7; row += 1) {
      const bits = rows[row];
      for (let col = 0; col < 5; col += 1) {
        if (((bits >> (4 - col)) & 1) === 0) continue;
        ctx.fillRect(
          startX + d * unit * 6 + col * unit,
          startY + row * unit,
          unit * 1.04,
          unit * 1.04,
        );
      }
    }
  }
}

function flashFor(flash, id) {
  if (!flash) return 0;
  const value = typeof flash.get === "function" ? flash.get(id) : flash[id];
  return value == null ? 0 : value;
}

export function createCanvas2dRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  const renderer = { backend: "canvas2d" };
  let size = { width: 0, height: 0, dpr: 1 };
  let destroyed = false;

  renderer.resize = function resize(next) {
    size = {
      width: Math.max(1, next.width || 0),
      height: Math.max(1, next.height || 0),
      dpr: next.dpr || 1,
    };
    canvas.width = Math.max(1, Math.round(size.width * size.dpr));
    canvas.height = Math.max(1, Math.round(size.height * size.dpr));
    if (canvas.style) {
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
    }
  };

  renderer.draw = function draw(frame) {
    if (destroyed || !ctx) return;
    const w = size.width;
    const h = size.height;
    if (!w || !h) return;

    const gap = w * 0.03;
    const cell = Math.max(1, (w - gap * 5) / 4);
    const progress = frame.progress == null ? 1 : frame.progress;
    const flash = frame.anim ? frame.anim.flash : null;

    ctx.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = "#0B0B10";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    roundRect(ctx, 0.5, 0.5, w - 1, h - 1, cell * 0.15);
    ctx.clip();
    ctx.fillStyle = "#14141C";
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.42, w * 0.72);
    glow.addColorStop(0, "rgba(255, 75, 7, 0.16)");
    glow.addColorStop(1, "rgba(255, 75, 7, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    const glow2 = ctx.createRadialGradient(w * 0.88, h * 0.94, 0, w * 0.88, h * 0.94, w * 0.55);
    glow2.addColorStop(0, "rgba(46, 134, 255, 0.16)");
    glow2.addColorStop(1, "rgba(46, 134, 255, 0)");
    ctx.fillStyle = glow2;
    ctx.fillRect(0, 0, w, h);

    const pulse = 0.5 + 0.5 * Math.sin(frame.time * 0.25 + 1.2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.012 + 0.012 * pulse})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        const x = gap + c * (cell + gap);
        const y = gap + r * (cell + gap);
        ctx.fillStyle = "#1D1D26";
        roundRect(ctx, x, y, cell, cell, cell * 0.17);
        ctx.fill();
      }
    }

    const tiles = frame.tiles || [];
    const from = frame.anim ? frame.anim.from : null;
    for (let i = 0; i < tiles.length; i += 1) {
      const tile = tiles[i];
      const start = from && from[i] ? from[i] : { row: tile.row, col: tile.col };
      const col = start.col + (tile.col - start.col) * progress;
      const row = start.row + (tile.row - start.row) * progress;
      const x = gap + col * (cell + gap);
      const y = gap + row * (cell + gap);
      const value = flashFor(flash, tile.id);
      const scale = tile.merged ? 1 + 0.14 * value : 1;
      const tw = cell * scale;
      const th = cell * scale;
      const tx = x + (cell - tw) / 2;
      const ty = y + (cell - th) / 2;
      const base = tileColor(tile.value);
      let fill = rgbStr(base);
      if (tile.merged && value > 0) {
        const mix = Math.min(0.55, value * 0.55);
        fill = rgbStr([
          base[0] + (1 - base[0]) * mix,
          base[1] + (0.96 - base[1]) * mix,
          base[2] + (0.9 - base[2]) * mix,
        ]);
      }
      ctx.fillStyle = fill;
      roundRect(ctx, tx, ty, tw, th, cell * 0.17 * scale);
      ctx.fill();
      drawDigits(ctx, tile.value, x, y, cell);
    }

    const particles = frame.particles || [];
    if (particles.length) {
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      for (const p of particles) {
        const age = Math.max(0, Math.min(1, p.age || 0));
        const px = (p.originX != null ? p.originX : p.x || 0) + (p.vx || 0) * age;
        const py = (p.originY != null ? p.originY : p.y || 0) + (p.vy || 0) * age;
        const radius = Math.max(0.5, ((p.size || 8) * (1 - age * 0.65)) / 2);
        const alpha = 1 - age * 0.5;
        const grad = ctx.createRadialGradient(px, py, 0, px, py, radius);
        grad.addColorStop(0, `rgba(255, 75, 7, ${alpha})`);
        grad.addColorStop(0.72, `rgba(255, 75, 7, ${alpha * 0.55})`);
        grad.addColorStop(1, "rgba(255, 75, 7, 0)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(px, py, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  };

  renderer.destroy = function destroy() {
    destroyed = true;
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return renderer;
}
