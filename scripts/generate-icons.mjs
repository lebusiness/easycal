// Генерация PNG-иконок для PWA без внешних зависимостей (чистый Node: zlib + ручная сборка PNG).
// Рисует «тарелку» (кольцо + центр) на изумрудном градиенте.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
mkdirSync(publicDir, { recursive: true });

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BG_TOP = [16, 185, 129]; // emerald-500
const BG_BOTTOM = [4, 120, 87]; // emerald-700

function sdRoundedSquare(u, v, r) {
  const qx = Math.abs(u - 0.5) - (0.5 - r);
  const qy = Math.abs(v - 0.5) - (0.5 - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

// fullBleed: без прозрачных углов (maskable и apple-touch-icon)
function sample(u, v, fullBleed) {
  if (!fullBleed && sdRoundedSquare(u, v, 0.225) > 0) return [0, 0, 0, 0];
  let r = Math.round(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * v);
  let g = Math.round(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * v);
  let b = Math.round(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * v);
  const scale = fullBleed ? 0.8 : 1;
  const d = Math.hypot(u - 0.5, v - 0.5) / scale;
  if (Math.abs(d - 0.3) <= 0.034 || d <= 0.155) {
    r = 255;
    g = 255;
    b = 255;
  }
  return [r, g, b, 255];
}

function renderIcon(size, fullBleed) {
  const rgba = Buffer.alloc(size * size * 4);
  const SS = 4; // суперсэмплинг для сглаживания краёв
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let ar = 0;
      let ag = 0;
      let ab = 0;
      let aa = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [r, g, b, a] = sample((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size, fullBleed);
          const af = a / 255;
          ar += r * af;
          ag += g * af;
          ab += b * af;
          aa += af;
        }
      }
      const n = SS * SS;
      const alpha = aa / n;
      const i = (py * size + px) * 4;
      if (alpha > 0) {
        rgba[i] = Math.round(ar / n / alpha);
        rgba[i + 1] = Math.round(ag / n / alpha);
        rgba[i + 2] = Math.round(ab / n / alpha);
      }
      rgba[i + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, rgba);
}

const targets = [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];

for (const [name, size, fullBleed] of targets) {
  writeFileSync(join(publicDir, name), renderIcon(size, fullBleed));
  console.log('✓', name);
}
