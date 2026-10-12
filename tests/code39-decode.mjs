// Independent Code 39 decoder used only to prove the generated barcodes encode the PRO.
import zlib from 'node:zlib';

// Standard Code 39 patterns: 9 elements (bar,space,bar,...), 1 = wide.
const TABLE = {
  '000110100': '0', '100100001': '1', '001100001': '2', '101100000': '3', '000110001': '4',
  '100110000': '5', '001110000': '6', '000100101': '7', '100100100': '8', '001100100': '9',
  '100001001': 'A', '001001001': 'B', '101001000': 'C', '000011001': 'D', '100011000': 'E', '001011000': 'F',
  '000001101': 'G', '100001100': 'H', '001001100': 'I', '000011100': 'J', '100000011': 'K', '001000011': 'L',
  '101000010': 'M', '000010011': 'N', '100010010': 'O', '001010010': 'P', '000000111': 'Q', '100000110': 'R',
  '001000110': 'S', '000010110': 'T', '110000001': 'U', '011000001': 'V', '111000000': 'W', '010010001': 'X',
  '110010000': 'Y', '011010000': 'Z', '010000101': '-', '010010100': '*',
};

/** Decode an 8-bit PNG (gray/RGB/RGBA) into { width, height, dark(x,y) }. */
export function readPng(buf) {
  let p = 8, width, height, colorType, idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString('ascii', p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); if (data[8] !== 8) throw new Error('bit depth'); colorType = data[9]; }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp, out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0;
      const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      out[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  return { width, height, dark: (x, y) => out[y * stride + x * bpp] < 128 };
}

export function decodeCode39(png) {
  const { width, height, dark } = readPng(png);
  const y = Math.floor(height / 2);
  const runs = [];
  let cur = dark(0, y), n = 0;
  for (let x = 0; x < width; x++) { const d = dark(x, y); if (d === cur) n++; else { runs.push([cur, n]); cur = d; n = 1; } }
  runs.push([cur, n]);
  while (runs.length && !runs[0][0]) runs.shift();
  while (runs.length && !runs[runs.length - 1][0]) runs.pop();
  const narrow = Math.min(...runs.map((r) => r[1]));
  let text = '';
  for (let i = 0; i + 9 <= runs.length; i += 10) {
    const key = runs.slice(i, i + 9).map((r) => (r[1] > narrow * 1.6 ? 1 : 0)).join('');
    if (!TABLE[key]) throw new Error(`unknown pattern ${key}`);
    text += TABLE[key];
  }
  if (!text.startsWith('*') || !text.endsWith('*')) throw new Error(`missing start/stop: ${text}`);
  return text.slice(1, -1);
}
