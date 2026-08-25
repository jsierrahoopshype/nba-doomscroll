/* Minimal PNG decode / resize / encode on Node's built-in zlib.
 *
 * Used by tools/build_races.mjs to bake the bar-chart-race "rectangle"
 * headshot transform at build time: crop the top 80% of the source, squash to a
 * 1.4:1 landscape tile, and write a small PNG the browser can draw as-is. Doing
 * it here rather than in the canvas means the site ships ~8KB tiles instead of
 * ~55KB portraits, and the renderer needs no crop logic at all.
 *
 * No dependency on purpose: these builders are run with a bare `node
 * tools/build_races.mjs`, and an image library would mean an npm install first.
 * Handles 8-bit non-interlaced RGB / RGBA / greyscale, which covers every file
 * in bar-chart-race/assets/headshots and nba-headshots.
 */

import fs from "fs";
import zlib from "zlib";

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };   // grey, rgb, grey+a, rgba

/** @returns {{w:number,h:number,data:Buffer}|null} data is RGBA, 4 bytes/px */
export function decodePng(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) { return null; }
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) return null;

  let w = 0, h = 0, depth = 0, colour = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === "PLTE") palette = data;
    else if (type === "tRNS") trns = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!w || !h || depth !== 8 || interlace !== 0) return null;
  const ch = colour === 3 ? 1 : CHANNELS[colour];
  if (!ch) return null;
  if (colour === 3 && !palette) return null;

  let raw;
  try { raw = zlib.inflateSync(Buffer.concat(idat)); } catch (e) { return null; }

  const stride = w * ch;
  if (raw.length < (stride + 1) * h) return null;

  const cur = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  const out = Buffer.alloc(w * h * 4);

  for (let y = 0; y < h; y++) {
    const base = y * (stride + 1);
    const filter = raw[base];
    raw.copy(cur, 0, base + 1, base + 1 + stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const b = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = cur[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4, s = x * ch;
      if (colour === 3) {
        const idx = cur[s];
        out[o] = palette[idx * 3]; out[o + 1] = palette[idx * 3 + 1]; out[o + 2] = palette[idx * 3 + 2];
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      } else if (colour === 0) {
        out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = 255;
      } else if (colour === 4) {
        out[o] = out[o + 1] = out[o + 2] = cur[s]; out[o + 3] = cur[s + 1];
      } else if (colour === 2) {
        out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = 255;
      } else {
        out[o] = cur[s]; out[o + 1] = cur[s + 1]; out[o + 2] = cur[s + 2]; out[o + 3] = cur[s + 3];
      }
    }
    cur.copy(prev);
  }
  return { w, h, data: out };
}

/** Box-filter downscale. Averages in premultiplied alpha so transparent pixels
 *  do not bleed their colour into the edges of a cut-out. */
export function resize(img, dw, dh) {
  const { w, h, data } = img;
  const out = Buffer.alloc(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy0 = Math.floor(y * h / dh), sy1 = Math.max(sy0 + 1, Math.floor((y + 1) * h / dh));
    for (let x = 0; x < dw; x++) {
      const sx0 = Math.floor(x * w / dw), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * w / dw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1; sy++) {
        for (let sx = sx0; sx < sx1; sx++) {
          const o = (sy * w + sx) * 4, al = data[o + 3] / 255;
          r += data[o] * al; g += data[o + 1] * al; b += data[o + 2] * al; a += data[o + 3];
          n++;
        }
      }
      const o = (y * dw + x) * 4;
      const am = a / n;
      const un = am > 0 ? 255 / am : 0;
      out[o] = Math.min(255, Math.round(r / n * un));
      out[o + 1] = Math.min(255, Math.round(g / n * un));
      out[o + 2] = Math.min(255, Math.round(b / n * un));
      out[o + 3] = Math.round(am);
    }
  }
  return { w: dw, h: dh, data: out };
}

export function crop(img, x, y, w, h) {
  const out = Buffer.alloc(w * h * 4);
  for (let j = 0; j < h; j++) {
    img.data.copy(out, j * w * 4, ((y + j) * img.w + x) * 4, ((y + j) * img.w + x + w) * 4);
  }
  return { w, h, data: out };
}

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = (crc ^ buf[i]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(img) {
  const { w, h, data } = img;
  // Paeth (filter 4) on every scanline rather than None. These tiles are
  // photographs, where neighbouring pixels are highly correlated, and letting
  // zlib compress residuals instead of raw samples takes about a third off the
  // file for no visible change.
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (stride + 1);
    raw[o] = 4;
    for (let i = 0; i < stride; i++) {
      const cur = data[y * stride + i];
      const a = i >= 4 ? data[y * stride + i - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + i] : 0;
      const c = (i >= 4 && y > 0) ? data[(y - 1) * stride + i - 4] : 0;
      const pp = a + b - c;
      const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
      const pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      raw[o + 1 + i] = (cur - pred) & 0xff;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    SIG,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/** The bar-chart-race "rectangle" headshot transform, baked in:
 *  crop the top 80% of the source, then squash to a 1.4:1 landscape tile. */
export function raceFaceTile(srcFile, outW, outH) {
  const img = decodePng(srcFile);
  if (!img) return null;
  const cropped = crop(img, 0, 0, img.w, Math.max(1, Math.round(img.h * 0.80)));
  return encodePng(resize(cropped, outW, outH));
}
