// Drawing helpers shared by every document. Coordinates are given from the TOP of the page
// (like the PaceJet layouts) and converted to PDF's bottom-left origin here.
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';
import bwipjs from 'bwip-js';

export const BLACK = rgb(0, 0, 0);
export const BLUE = rgb(0.13, 0.24, 0.55);
export const GREY = rgb(0.93, 0.93, 0.93);

export async function code39Png(text) {
  return bwipjs.toBuffer({ bcid: 'code39', text: String(text), scale: 3, height: 9, includetext: false, paddingwidth: 12, backgroundcolor: 'FFFFFF' });
}

export async function newDoc() {
  const doc = await PDFDocument.create();
  const fonts = { reg: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold), boldIt: await doc.embedFont(StandardFonts.HelveticaBoldOblique) };
  let logo = null;
  const logoPath = process.env.LOGO_FILE || path.resolve(process.cwd(), 'assets/logo.png');
  if (fs.existsSync(logoPath)) logo = await doc.embedPng(fs.readFileSync(logoPath));
  return { doc, fonts, logo };
}

export function painter(page, fonts) {
  const H = page.getHeight();
  const p = {
    text(str, x, top, { size = 9, font = 'reg', color = BLACK, maxWidth } = {}) {
      let s = String(str ?? '');
      const f = fonts[font];
      if (maxWidth) while (s && f.widthOfTextAtSize(s, size) > maxWidth) s = s.slice(0, -1);
      page.drawText(s, { x, y: H - top - size, size, font: f, color });
    },
    right(str, xRight, top, opts = {}) {
      const f = fonts[opts.font || 'reg'];
      p.text(str, xRight - f.widthOfTextAtSize(String(str), opts.size || 9), top, opts);
    },
    center(str, xMid, top, opts = {}) {
      const f = fonts[opts.font || 'reg'];
      p.text(str, xMid - f.widthOfTextAtSize(String(str), opts.size || 9) / 2, top, opts);
    },
    /** Word-wrap; returns the height used. */
    para(str, x, top, width, { size = 6.3, font = 'reg', leading = 1.18 } = {}) {
      const f = fonts[font];
      const words = String(str).split(/\s+/);
      let line = '', y = top;
      for (const w of words) {
        const t = line ? `${line} ${w}` : w;
        if (f.widthOfTextAtSize(t, size) > width && line) { p.text(line, x, y, { size, font }); y += size * leading; line = w; } else line = t;
      }
      if (line) { p.text(line, x, y, { size, font }); y += size * leading; }
      return y - top;
    },
    line(x1, top1, x2, top2, thickness = 0.8) { page.drawLine({ start: { x: x1, y: H - top1 }, end: { x: x2, y: H - top2 }, thickness, color: BLACK }); },
    box(x, top, w, h, { thickness = 0.8, fill } = {}) {
      page.drawRectangle({ x, y: H - top - h, width: w, height: h, borderWidth: thickness, borderColor: BLACK, color: fill });
    },
    fill(x, top, w, h, color = GREY) { page.drawRectangle({ x, y: H - top - h, width: w, height: h, color }); },
    image(img, x, top, w, h) { page.drawImage(img, { x, y: H - top - h, width: w, height: h }); },
    svg(d, x, top, scale) { page.drawSvgPath(d, { x, y: H - top, scale, color: BLACK, borderWidth: 0 }); },
  };
  return p;
}

// Generic text wordmark for the portfolio edition (drop a real logo at assets/logo.png to use it instead).
export function drawLogo(p, logo, x, top, w) {
  if (logo) return p.image(logo, x, top, w, w * (logo.height / logo.width));
  p.text('ACME', x, top - 2, { size: w / 3.4, font: 'bold' });
}

export function mockWatermark(page, fonts) {
  page.drawText('MOCK MODE - NOT A REAL SHIPMENT', {
    x: 70, y: page.getHeight() / 2 - 120, size: 40, font: fonts.bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.18, rotate: degrees(40),
  });
}

export const mmddyyyy = (iso) => { const [y, m, d] = String(iso).slice(0, 10).split('-'); return `${m}/${d}/${y}`; };
export const fmtWt = (n) => Number(n).toFixed(1);
export const addrLines = (a) => [
  a.name, a.attn ? `Attn: ${a.attn}` : null,
  a.address1, a.address2 || null, `${a.city}, ${a.state}  ${a.zip}`, a.phone,
].filter(Boolean);
