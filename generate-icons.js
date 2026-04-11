#!/usr/bin/env node
// generate-icons.js — Pure Node.js PNG icon generator for ParallelChat
// Usage: node generate-icons.js
// Outputs: icons/icon16.png, icons/icon48.png, icons/icon128.png

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

// ───── CRC32 ─────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ───── PNG encoding ──────────────────────────────────────────────────────────

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const lenBuf    = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([lenBuf, typeBytes, data, crcBuf]);
}

function makePNG(w, h, rgba) {
  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA

  // Raw scanlines: filter-byte(0) + 4 bytes/pixel
  const rows = [];
  for (let y = 0; y < h; y++) {
    const row = Buffer.alloc(1 + w * 4);
    row[0] = 0; // filter: None
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      row.set(rgba.slice(s, s + 4), 1 + x * 4);
    }
    rows.push(row);
  }

  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ───── Math helpers ──────────────────────────────────────────────────────────

function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function clamp01(x)        { return clamp(x, 0, 1); }

function hex(str) {
  const n = parseInt(str.replace('#', ''), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

// Over-composite: blend fg over bg with opacity alpha [0-1]
function over(bg, fg, a) {
  return [
    Math.round(bg[0] + (fg[0] - bg[0]) * a),
    Math.round(bg[1] + (fg[1] - bg[1]) * a),
    Math.round(bg[2] + (fg[2] - bg[2]) * a),
  ];
}

// SDF: signed distance to axis-aligned rounded rectangle
// Returns negative inside, positive outside
function sdRRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  return Math.sqrt(Math.max(qx, 0) ** 2 + Math.max(qy, 0) ** 2) - r
       + Math.min(Math.max(qx, qy), 0);
}

// SDF: circle
function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

// Anti-aliased coverage from SDF distance (1 = fully inside, 0 = outside)
function coverage(d, aa = 1.0) { return clamp01((aa - d) / aa); }

// ───── Pixel canvas ──────────────────────────────────────────────────────────

function createCanvas(w, h, bgHex = '#0d0d1a') {
  const px = new Uint8Array(w * h * 4);
  const bg = hex(bgHex);
  for (let i = 0; i < w * h; i++) {
    px[i*4]   = bg[0];
    px[i*4+1] = bg[1];
    px[i*4+2] = bg[2];
    px[i*4+3] = 255;
  }
  return px;
}

function setPixel(px, w, x, y, rgb, alpha) {
  if (x < 0 || y < 0 || x >= w) return;
  const i = (y * w + x) * 4;
  const bg = [px[i], px[i+1], px[i+2]];
  const c = over(bg, rgb, alpha);
  px[i] = c[0]; px[i+1] = c[1]; px[i+2] = c[2]; px[i+3] = 255;
}

// ───── Drawing primitives ────────────────────────────────────────────────────

// Draw glow halo behind a shape
function drawGlow(px, w, h, glowFn, color, glowRadius = 12, strength = 0.35) {
  const rgb = hex(color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = glowFn(x + 0.5, y + 0.5);
      if (d > glowRadius) continue;
      const a = clamp01(1 - d / glowRadius) ** 2 * strength;
      setPixel(px, w, x, y, rgb, a);
    }
  }
}

// Draw anti-aliased shape from SDF
function drawShape(px, w, h, sdfFn, color, opacity = 1.0) {
  const rgb = hex(color);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = sdfFn(x + 0.5, y + 0.5);
      const a = coverage(d, 1.2) * opacity;
      if (a < 0.004) continue;
      setPixel(px, w, x, y, rgb, a);
    }
  }
}

// Draw text-line placeholder inside bubble (lighter color)
function drawBubbleLines(px, w, cx, cy, bw, bh, color) {
  const rgb = hex(color);
  // Brighten color for inner lines
  const light = rgb.map(c => Math.min(255, c + 90));

  const lineH = Math.max(1.5, bh * 0.09);
  const lines = [
    { y: cy - bh * 0.12, lw: bw * 0.52 },
    { y: cy + bh * 0.12, lw: bw * 0.35 },
  ];

  for (const { y: ly, lw } of lines) {
    const x0 = cx - lw / 2, x1 = cx + lw / 2;
    const y0 = ly - lineH,  y1 = ly + lineH;
    for (let py = Math.floor(y0 - 1); py <= Math.ceil(y1 + 1); py++) {
      for (let px2 = Math.floor(x0 - 1); px2 <= Math.ceil(x1 + 1); px2++) {
        const dx = Math.max(0, Math.abs(px2 + 0.5 - cx) - lw / 2);
        const dy = Math.max(0, Math.abs(py + 0.5 - ly) - lineH);
        const d  = Math.hypot(dx, dy);
        const a  = coverage(d, 1.0) * 0.65;
        if (a < 0.004) continue;
        setPixel(px, w, px2, py, light, a);
      }
    }
  }
}

// ───── Chat bubble (rounded rect + tail triangle) ────────────────────────────

function drawChatBubble(pxBuf, W, H, { cx, cy, bw, bh, r, tailSide, color, glowPx }) {
  const hw = bw / 2, hh = bh / 2;

  // --- glow ---
  const glowFn = (px, py) => sdRRect(px, py, cx, cy, hw, hh, r);
  drawGlow(pxBuf, W, H, glowFn, color, glowPx, 0.38);

  // --- shadow (dark halo below) ---
  const shadowColor = '#000000';
  const shadowOff = bh * 0.06;
  const shadowFn  = (px, py) => sdRRect(px, py, cx, cy + shadowOff, hw * 1.05, hh * 0.7, r);
  drawGlow(pxBuf, W, H, shadowFn, shadowColor, bh * 0.25, 0.22);

  // --- body ---
  drawShape(pxBuf, W, H, glowFn, color, 0.92);

  // --- tail (small downward triangle) ---
  const tailDir = tailSide === 'left' ? -1 : tailSide === 'right' ? 1 : 0;
  const tailCx  = cx + tailDir * hw * 0.45;
  const tailTop = cy + hh - r * 0.4;
  const tailBot = tailTop + bh * 0.28;
  const tailW   = bw * 0.09;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      if (py + 0.5 < tailTop - 2 || py + 0.5 > tailBot + 1) continue;
      const progress = (py + 0.5 - tailTop) / (tailBot - tailTop);
      if (progress < 0 || progress > 1) continue;
      const halfW = tailW * (1 - progress);
      const d     = Math.abs(px + 0.5 - tailCx) - halfW;
      const a     = coverage(d, 1.0) * 0.92;
      if (a < 0.004) continue;
      const rgb = hex(color);
      setPixel(pxBuf, W, px, py, rgb, a);
    }
  }

  // --- inner text lines ---
  drawBubbleLines(pxBuf, W, cx, cy, bw, bh, color);
}

// ───── Pig character ──────────────────────────────────────────────────────────

const PIG_PINK      = '#ffaab8';
const PIG_INNER_EAR = '#ff7a90';
const PIG_SNOUT     = '#ff8fa0';
const PIG_NOSTRIL   = '#cc4a60';
const PIG_EYE       = '#1a0a10';
const PIG_SHINE     = '#ffffff';
const BUBBLE_COLOR  = '#6c63ff';

// SDF: axis-aligned ellipse (approximate, good enough for AA rendering)
function sdEllipse(px, py, cx, cy, rx, ry) {
  const dx = (px - cx) / rx;
  const dy = (py - cy) / ry;
  return (Math.hypot(dx, dy) - 1.0) * Math.min(rx, ry);
}

function drawPigFace(buf, W, H, cx, cy, r) {
  const earOffX = r * 0.72;
  const earOffY = r * 0.72;
  const earCy   = cy - earOffY;
  const earR    = r * 0.44;
  const innerR  = earR * 0.55;

  // Ears — drawn first so head overlaps base
  for (const ecx of [cx - earOffX, cx + earOffX]) {
    drawGlow(buf, W, H, (px, py) => sdCircle(px, py, ecx, earCy, earR), PIG_PINK, earR * 0.5, 0.28);
    drawShape(buf, W, H, (px, py) => sdCircle(px, py, ecx, earCy, earR), PIG_PINK);
    drawShape(buf, W, H, (px, py) => sdCircle(px, py, ecx, earCy, innerR), PIG_INNER_EAR, 0.85);
  }

  // Head
  drawGlow(buf, W, H, (px, py) => sdCircle(px, py, cx, cy, r), PIG_PINK, r * 0.4, 0.32);
  drawShape(buf, W, H, (px, py) => sdCircle(px, py, cx, cy, r), PIG_PINK);

  // Eyes (skip if too small)
  if (r >= 6) {
    const eyeY = cy - r * 0.14;
    const eyeR = Math.max(1.0, r * 0.115);
    const eyeX = r * 0.30;
    for (const ex of [cx - eyeX, cx + eyeX]) {
      drawShape(buf, W, H, (px, py) => sdCircle(px, py, ex, eyeY, eyeR), PIG_EYE);
      if (r >= 12) {
        // Shine dot
        drawShape(buf, W, H, (px, py) =>
          sdCircle(px, py, ex + eyeR * 0.35, eyeY - eyeR * 0.35, eyeR * 0.38), PIG_SHINE);
      }
    }
  }

  // Snout (ellipse)
  const snoutCy = cy + r * 0.27;
  const snoutRx = r * 0.37;
  const snoutRy = r * 0.26;
  drawShape(buf, W, H, (px, py) => sdEllipse(px, py, cx, snoutCy, snoutRx, snoutRy), PIG_SNOUT, 0.9);

  // Nostrils
  if (r >= 10) {
    const nR = Math.max(0.8, r * 0.075);
    const nX = r * 0.14;
    for (const nx of [cx - nX, cx + nX]) {
      drawShape(buf, W, H, (px, py) => sdCircle(px, py, nx, snoutCy, nR), PIG_NOSTRIL);
    }
  }
}

// ───── Icon designs by size ──────────────────────────────────────────────────

function generateIcon16() {
  const W = 16, H = 16;
  const px = createCanvas(W, H);

  // Pig face only — centered
  drawPigFace(px, W, H, 8, 9.5, 6.2);

  return makePNG(W, H, px);
}

function generateIcon48() {
  const W = 48, H = 48;
  const px = createCanvas(W, H);

  // Pig face (left side)
  drawPigFace(px, W, H, 16, 30, 12);

  // Chat bubble (upper right, speech from pig)
  drawChatBubble(px, W, H, {
    cx: 36, cy: 14, bw: 20, bh: 14,
    r: 4, tailSide: 'left', color: BUBBLE_COLOR, glowPx: 7,
  });

  return makePNG(W, H, px);
}

function generateIcon128() {
  const W = 128, H = 128;
  const px = createCanvas(W, H);

  // Pig face (left-center)
  drawPigFace(px, W, H, 40, 78, 30);

  // Chat bubble (upper right, speech from pig)
  drawChatBubble(px, W, H, {
    cx: 96, cy: 38, bw: 48, bh: 34,
    r: 10, tailSide: 'left', color: BUBBLE_COLOR, glowPx: 16,
  });

  return makePNG(W, H, px);
}

// ───── Main ──────────────────────────────────────────────────────────────────

const iconsDir = path.join(__dirname, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

const generators = { 16: generateIcon16, 48: generateIcon48, 128: generateIcon128 };
for (const [size, gen] of Object.entries(generators)) {
  const buf  = gen();
  const file = path.join(iconsDir, `icon${size}.png`);
  fs.writeFileSync(file, buf);
  console.log(`✓ icon${size}.png  (${buf.length} bytes)`);
}
console.log('Icons generated in ./icons/');
