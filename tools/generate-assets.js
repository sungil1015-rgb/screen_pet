const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    raw[row] = 0;
    rgba.copy(raw, row + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function pngToIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = [];
  let offset = 6 + 16 * count;
  const parts = [header];
  images.forEach((img) => {
    const entry = Buffer.alloc(16);
    entry[0] = img.w >= 256 ? 0 : img.w;
    entry[1] = img.h >= 256 ? 0 : img.h;
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(img.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += img.png.length;
  });
  return Buffer.concat(parts.concat(entries, images.map((img) => img.png)));
}

function makeCanvas(w, h) {
  const data = Buffer.alloc(w * h * 4);
  function px(x, y, color) {
    const ix = x | 0;
    const iy = y | 0;
    if (ix < 0 || iy < 0 || ix >= w || iy >= h || !color) return;
    const a = color[3] == null ? 255 : color[3];
    if (a <= 0) return;
    const i = (iy * w + ix) * 4;
    if (a >= 255 || data[i + 3] === 0) {
      data[i] = color[0];
      data[i + 1] = color[1];
      data[i + 2] = color[2];
      data[i + 3] = a;
      return;
    }
    const sa = a / 255;
    const da = data[i + 3] / 255;
    const out = sa + da * (1 - sa);
    data[i] = Math.round((color[0] * sa + data[i] * da * (1 - sa)) / out);
    data[i + 1] = Math.round((color[1] * sa + data[i + 1] * da * (1 - sa)) / out);
    data[i + 2] = Math.round((color[2] * sa + data[i + 2] * da * (1 - sa)) / out);
    data[i + 3] = Math.round(out * 255);
  }
  function fillEllipse(cx, cy, rx, ry, color) {
    if (rx <= 0 || ry <= 0) return;
    const x0 = Math.floor(cx - rx - 1);
    const x1 = Math.ceil(cx + rx + 1);
    const y0 = Math.floor(cy - ry - 1);
    const y1 = Math.ceil(cy + ry + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        if (nx * nx + ny * ny <= 1) px(x, y, color);
      }
    }
  }
  function fillTri(x0, y0, x1, y1, x2, y2, color) {
    const minY = Math.floor(Math.min(y0, y1, y2));
    const maxY = Math.ceil(Math.max(y0, y1, y2));
    const edges = [[x0, y0, x1, y1], [x1, y1, x2, y2], [x2, y2, x0, y0]];
    for (let y = minY; y <= maxY; y++) {
      const xs = [];
      for (let e = 0; e < edges.length; e++) {
        const ax = edges[e][0];
        const ay = edges[e][1];
        const bx = edges[e][2];
        const by = edges[e][3];
        if ((ay <= y && by > y) || (by <= y && ay > y)) {
          const t = (y + 0.5 - ay) / (by - ay);
          xs.push(ax + t * (bx - ax));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let x = Math.ceil(xs[0]); x <= Math.floor(xs[xs.length - 1]); x++) px(x, y, color);
    }
  }
  return { w: w, h: h, data: data, px: px, fillEllipse: fillEllipse, fillTri: fillTri };
}

const LINE = [92, 62, 44, 255];
const FUR = [244, 214, 168, 255];
const FUR2 = [230, 190, 136, 255];
const BELLY = [255, 246, 230, 255];
const EAR = [236, 170, 154, 255];
const NOSE = [214, 118, 112, 255];
const EYE = [54, 38, 30, 255];
const HI = [255, 250, 244, 255];
const PAW = [255, 236, 216, 255];
const BLUSH = [232, 156, 138, 180];

function outlinedEllipse(c, x, y, rx, ry, fill) {
  c.fillEllipse(x, y, rx + 1.05, ry + 1.05, LINE);
  c.fillEllipse(x, y, rx, ry, fill);
}

function ear(c, ax, ay, bx, by, cx, cy) {
  c.fillTri(ax, ay, bx, by, cx, cy, LINE);
  c.fillTri(
    ax + (bx - ax) * 0.18,
    ay + (by - ay) * 0.18,
    bx + (ax - bx) * 0.08,
    by + 1.4,
    cx + (ax - cx) * 0.16,
    cy + (ay - cy) * 0.12,
    EAR
  );
}

function leg(c, x, yTop, yBot, shift) {
  const steps = 5;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const lx = x + shift * t;
    const ly = yTop + (yBot - yTop) * t;
    const r = 2.55 - t * 0.55;
    c.fillEllipse(lx, ly, r + 0.9, r + 0.7, LINE);
    c.fillEllipse(lx, ly, r, r - 0.15, FUR);
  }
  c.fillEllipse(x + shift, yBot, 3.4, 1.7, LINE);
  c.fillEllipse(x + shift, yBot - 0.3, 2.5, 1.15, PAW);
}

function tail(c, x, y, curl, sit) {
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const px = sit ? x - t * 9 : x - t * 8 + Math.sin(t * 3) * curl;
    const py = sit ? y + Math.sin(t * Math.PI) * (2 + curl) : y - Math.sin(t * Math.PI) * (8 + curl) - t * 2;
    const r = 3.1 - t * 1.15;
    c.fillEllipse(px, py, r + 0.9, r + 0.9, LINE);
    c.fillEllipse(px, py, r, r, FUR2);
  }
}

function face(c, hx, hy, blink) {
  if (blink) {
    c.px(hx + 3, hy - 1, LINE);
    c.px(hx + 4, hy - 1, LINE);
    c.px(hx + 5, hy - 1, LINE);
    c.px(hx + 6, hy - 1, LINE);
  } else {
    c.fillEllipse(hx + 5, hy - 1, 1.7, 2.1, EYE);
    c.px(hx + 4, hy - 2, HI);
  }
  c.fillEllipse(hx + 8, hy + 2, 1.35, 1.05, NOSE);
  c.px(hx + 8, hy + 4, LINE);
  c.px(hx + 9, hy + 4, LINE);
  c.fillEllipse(hx + 2, hy + 3, 2.1, 1.2, BLUSH);
}

function drawStand(c, ox, oy, phase, blink, tailCurl, bob) {
  const ground = oy + 46;
  const bodyY = oy + 31 + bob;
  const headY = oy + 18 + bob;
  tail(c, ox + 14, bodyY - 2, tailCurl, false);
  leg(c, ox + 17, bodyY + 4, ground, phase.hind || 0);
  outlinedEllipse(c, ox + 22, bodyY, 11, 8.2, FUR);
  c.fillEllipse(ox + 24, bodyY + 2, 6.2, 5.2, BELLY);
  leg(c, ox + 27, bodyY + 5, ground, phase.front || 0);
  ear(c, ox + 24, headY - 2, ox + 28, oy + 5 + bob, ox + 33, headY - 1);
  ear(c, ox + 31, headY - 3, ox + 37, oy + 3 + bob, ox + 41, headY);
  outlinedEllipse(c, ox + 32, headY, 9.2, 8.1, FUR);
  c.fillEllipse(ox + 36, headY + 3, 4.6, 3.2, BELLY);
  face(c, ox + 31, headY, blink);
}

function drawSit(c, ox, oy, phase) {
  const ground = oy + 46;
  const bodyY = oy + 36;
  const headY = oy + 23;
  tail(c, ox + 16, ground - 3, phase.tail, true);
  outlinedEllipse(c, ox + 24, bodyY, 12, 7.2, FUR);
  c.fillEllipse(ox + 26, bodyY + 1, 7, 4.2, BELLY);
  c.fillEllipse(ox + 31, ground - 2, 3.2, 1.8, LINE);
  c.fillEllipse(ox + 31, ground - 2.4, 2.3, 1.2, PAW);
  c.fillEllipse(ox + 36, ground - 2, 3.2, 1.8, LINE);
  c.fillEllipse(ox + 36, ground - 2.4, 2.3, 1.2, PAW);
  ear(c, ox + 24, headY - 1, ox + 28, oy + 10, ox + 33, headY);
  ear(c, ox + 31, headY - 2, ox + 37, oy + 8, ox + 41, headY + 1);
  outlinedEllipse(c, ox + 31, headY, 9, 8, FUR);
  c.fillEllipse(ox + 35, headY + 3, 4.4, 3, BELLY);
  face(c, ox + 30, headY, phase.blink);
}

function drawFrame(c, index) {
  const col = index % 6;
  const row = Math.floor(index / 6);
  const ox = col * 48;
  const oy = row * 48;
  if (row === 0) {
    const idle = [
      { hind: 0, front: 1, bob: 0, blink: false, tail: 0 },
      { hind: 0, front: 1, bob: 0, blink: false, tail: 1 },
      { hind: 0, front: 1, bob: 1, blink: true, tail: 1 },
      { hind: 0, front: 1, bob: 1, blink: true, tail: 0 },
      { hind: 0, front: 1, bob: 0, blink: false, tail: -1 },
      { hind: 0, front: 1, bob: 0, blink: false, tail: 0 }
    ][col];
    drawStand(c, ox, oy, idle, idle.blink, idle.tail, idle.bob);
  } else if (row === 1) {
    const walk = [
      { hind: -6, front: 5, bob: 0, tail: 0 },
      { hind: -3, front: 6, bob: -1, tail: 1 },
      { hind: 1, front: 1, bob: -2, tail: 2 },
      { hind: 6, front: -5, bob: 0, tail: 1 },
      { hind: 3, front: -6, bob: -1, tail: 0 },
      { hind: -1, front: -1, bob: -2, tail: -1 }
    ][col];
    drawStand(c, ox, oy, walk, false, walk.tail, walk.bob);
  } else {
    drawSit(c, ox, oy, [
      { tail: 0, blink: false },
      { tail: 1, blink: false },
      { tail: 2, blink: false },
      { tail: 1, blink: true },
      { tail: 0, blink: true },
      { tail: -1, blink: false }
    ][col]);
  }
}

function scaleNN(src, w, h, factor) {
  const dw = w * factor;
  const dh = h * factor;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.floor(y / factor);
    for (let x = 0; x < dw; x++) {
      const sx = Math.floor(x / factor);
      src.copy(out, (y * dw + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  }
  return out;
}

function drawIcon(size) {
  const c = makeCanvas(size, size);
  const s = size / 48;
  c.fillEllipse(size / 2, size / 2 + s, size * 0.42, size * 0.42, [243, 214, 168, 255]);
  c.fillEllipse(size / 2, size / 2 + s, size * 0.42 - s, size * 0.42 - s, FUR);
  ear(c, 14 * s, 16 * s, 18 * s, 6 * s, 24 * s, 16 * s);
  ear(c, 24 * s, 15 * s, 31 * s, 5 * s, 34 * s, 16 * s);
  outlinedEllipse(c, 24 * s, 22 * s, 10 * s, 9 * s, FUR);
  c.fillEllipse(size * 0.58, size * 0.5, size * 0.045, size * 0.055, EYE);
  c.fillEllipse(size * 0.74, size * 0.5, size * 0.045, size * 0.055, EYE);
  c.fillEllipse(size * 0.66, size * 0.6, size * 0.03, size * 0.022, NOSE);
  return c;
}

function main() {
  const root = path.join(__dirname, '..', 'assets');
  fs.mkdirSync(root, { recursive: true });
  const sheet = makeCanvas(288, 144);
  for (let i = 0; i < 18; i++) drawFrame(sheet, i);
  let opaque = 0;
  let lowest = 0;
  for (let i = 3; i < sheet.data.length; i += 4) {
    if (sheet.data[i] > 0) {
      opaque++;
      const y = Math.floor((i / 4) / 288);
      if (y % 48 > lowest) lowest = y % 48;
    }
  }
  if (opaque < 1000) throw new Error('sprite empty');
  const png = encodePNG(288, 144, sheet.data);
  fs.writeFileSync(path.join(root, 'demo-sheet.png'), png);
  fs.writeFileSync(path.join(root, 'sheet-preview.png'), encodePNG(288 * 3, 144 * 3, scaleNN(sheet.data, 288, 144, 3)));
  const icon = drawIcon(256);
  const iconPng = encodePNG(256, 256, icon.data);
  fs.writeFileSync(path.join(root, 'icon.png'), iconPng);
  const small = drawIcon(32);
  const smallPng = encodePNG(32, 32, small.data);
  fs.writeFileSync(path.join(root, 'tray.png'), smallPng);
  fs.writeFileSync(path.join(root, 'icon.ico'), pngToIco([
    { w: 32, h: 32, png: smallPng },
    { w: 256, h: 256, png: iconPng }
  ]));
  console.log('assets ok', opaque, 'lowest', lowest);
}

main();
