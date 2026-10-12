// 4x6 shipping label (one per pallet), mirroring Acme's PaceJet "Ship Label 4x6" layout,
// plus a letter-size version for customers without a label printer.
import { PDFDocument, rgb } from 'pdf-lib';
import { newDoc, painter, code39Png, mmddyyyy, fmtWt, addrLines } from './common.mjs';
import { ACCESSORIAL_LABELS } from '../freight.mjs';
import { CARRIER } from '../../config/app-config.mjs';

const W = 288, H = 432; // 4 x 6 in

async function drawLabels(doc, fonts, rec) {
  const png = await doc.embedPng(await code39Png(rec.proNumber));
  const n = rec.pallets.length;
  rec.pallets.forEach((pl, i) => {
    const page = doc.addPage([W, H]);
    const p = painter(page, fonts);
    p.center('R+L Carriers', W / 2, 10, { size: 22 });
    p.center(CARRIER.serviceLevel, W / 2, 35, { size: 11 });
    const bw = Math.min(200, png.width * 0.33);
    p.image(png, W / 2 - bw / 2, 50, bw, 50);
    p.center(rec.proNumber, W / 2, 103, { size: 18 });

    p.text('FREIGHT TERMS', 13, 133, { size: 8, font: 'bold' });
    p.text(rec.accessorials.map((a) => ACCESSORIAL_LABELS[a] || a).join(', ') || 'PREPAID', 85, 133.5, { size: 7, maxWidth: 190 });
    p.text('TRACKID', 13, 150, { size: 8, font: 'bold' });
    p.text(rec.proNumber, 85, 150.5, { size: 7.5 });
    p.right(`Container ${i + 1} of ${n}`, 268, 172, { size: 10, font: 'bold' });
    p.line(8, 194, 280, 194, 1.6);

    p.text('SHIP DATE:', 18, 205, { size: 8, font: 'bold' });
    p.text(mmddyyyy(rec.pickupDate), 66, 205, { size: 8 });
    p.right(`Total Weight: ${fmtWt(rec.totals.weightLb)}-LB`, 272, 205, { size: 7 });
    p.text(`BOL: ${rec.bolNumber}`, 18, 220, { size: 8.5, font: 'bold', maxWidth: 140 });
    p.text(`PO: ${rec.salesOrder.po || ''}`, 160, 220, { size: 8.5, font: 'bold', maxWidth: 120 });
    p.text(`RMA: ${rec.rmaNumber}`, 18, 235, { size: 8.5, font: 'bold' });
    p.text(`SALES ORDER: ${rec.salesOrder.number}`, 18, 250, { size: 8.5, font: 'bold' });
    p.text(`This container: ${pl.type} ${pl.length}x${pl.width}x${pl.height}, ${fmtWt(pl.weightLb)} LB`, 18, 264, { size: 7 });
    p.line(8, 277, 280, 277, 1.6);

    const addr = (label, lines, top) => {
      p.text(label, 18, top, { size: 9, font: 'bold' });
      let y = top;
      for (const s of lines.slice(0, 5)) { p.text(s, 63, y, { size: 9, maxWidth: 212 }); y += 10.5; }
      return y;
    };
    const y = addr('FROM:', addrLines(rec.shipFrom).slice(0, -1), 288);
    addr('TO:', addrLines(rec.shipTo).slice(0, -1), Math.max(y + 8, 345));
    p.right('Return Label 4x6.Acme-FRP', 280, 418, { size: 4.5 });
    if (rec.mock) page.drawText('MOCK - NOT A REAL SHIPMENT', { x: 20, y: 150, size: 18, font: fonts.bold, color: rgb(0.85, 0.1, 0.1), opacity: 0.25 });
  });
}

export async function renderLabels4x6(rec) {
  const { doc, fonts } = await newDoc();
  await drawLabels(doc, fonts, rec);
  return doc.save();
}

/** Each 4x6 label scaled up and centred on its own letter page, with a cut line. */
export async function addLetterLabels(doc, rec) {
  const src = await PDFDocument.load(await renderLabels4x6(rec));
  const pages = await doc.embedPages(src.getPages());
  const scale = 1.4;
  for (const ep of pages) {
    const page = doc.addPage([612, 792]);
    const w = W * scale, h = H * scale, x = (612 - w) / 2, y = (792 - h) / 2;
    page.drawPage(ep, { x, y, xScale: scale, yScale: scale });
    page.drawRectangle({ x: x - 6, y: y - 6, width: w + 12, height: h + 12, borderColor: rgb(0.5, 0.5, 0.5), borderWidth: 0.6, borderDashArray: [4, 3] });
  }
}

export async function renderLabelsLetter(rec) {
  const doc = await PDFDocument.create();
  await addLetterLabels(doc, rec);
  return doc.save();
}

