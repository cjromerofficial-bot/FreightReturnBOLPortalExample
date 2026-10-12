// Straight Bill of Lading, mirroring Acme's PaceJet "Bill of Lading.RPT26.3" layout,
// adapted for R+L returns (Ship From = customer, Ship To = Acme warehouse).
import { newDoc, painter, drawLogo, mockWatermark, code39Png, mmddyyyy, fmtWt, addrLines, BLUE } from './common.mjs';
import { ACCESSORIAL_LABELS } from '../freight.mjs';
import { CARRIER, FREIGHT } from '../../config/app-config.mjs';

// Verbatim from Acme's example BOL (including its original wording).
export const LEGAL = {
  declaredValue: 'Note -- When the rate is dependent on value, shippers are required to state specifically in writing the agreed or declared value of the property.  The agreed or declared value of the property is hereby specifically stated by the shipper to be not exceeding:',
  declaredBlank: '$ ______________________    PER  ________________________',
  recourse: 'If this shipment is to be delivered to the consignee without recourse on the consignor, the consignor shall sign the following statement:  The carrier shall not make delivery of this shipment without payment of freight and all other lawful charges.',
  recourseSig: 'Signature of Consignor: ________________________________',
  received: 'Received, subject to the classifications and lawfully filed tariffs in effect on the date of the issue of the bill of lading, the property described above and in apparent good order, expect as noted (Contents and condition of contents of packages unknown), marked, consigned, and destined, as indicated above which said carrier (the word carrier being understood throughout this contract as meaning any person or corporation in possession of the property under the contract) agrees to carry to its usual place of delivery of said destination, if on its route, otherwise to deliver to another carrier on the route to said destination it is mutually agreed as to each carrier of all or any of said property over all or any portion of said route to destination and as to each party at any time interested in all or any of said property.  That every service to be performed hereunder shall be subject to all the conditions not prohibited by law, whether printed or written, herein contained, including the conditions on the back hereof, which are hereby agreed to by the shipper and accepted for himself and assigns.',
  dot: 'This is to certify that the above named materials are properly classified, described, packaged, marked and labeled are in proper condition for transportation according to the applicable regulations of the Department of Transportation.',
  header: 'RECEIVED, subject to the classifications and lawfully filed tariffs in effect on the date of the issue of the Bill of Lading.',
};

const L = 16, R = 595, C1 = 194, C2 = 414; // outer edges + column splits

export async function renderBol(rec) {
  const { doc, fonts, logo } = await newDoc();
  const page = doc.addPage([612, 792]);
  const p = painter(page, fonts);
  const pageNo = 1, pages = 1;

  // ---- header
  drawLogo(p, logo, L, 38, 120);
  p.text('STRAIGHT BILL OF LADING - SHORT FORM - Original Not Negotiable', 141, 27, { size: 10.5, color: BLUE });
  p.text(LEGAL.header, 148, 47, { size: 5.3, font: 'bold' });
  p.text('Page', 525, 30, { size: 9 });
  p.text(`${pageNo} of ${pages}`, 525, 42, { size: 9 });

  // ---- block 1: SHIP FROM | date/bol/quote/so/pro | carrier/terms
  const T1 = 85, H1 = 180;
  p.box(L, T1, R - L, H1);
  p.line(C1, T1, C1, T1 + H1); p.line(C2, T1, C2, T1 + H1);
  p.text('SHIP FROM', L + 8, T1 + 4, { size: 8.5, font: 'bold' }); p.line(L, T1 + 15, C1, T1 + 15);
  let y = T1 + 24;
  for (const s of addrLines(rec.shipFrom)) { p.text(s, L + 6, y, { size: 9, maxWidth: C1 - L - 10 }); y += 11.5; }
  if (rec.shipFrom.residential) p.text('This is a Residential address', L + 40, T1 + H1 - 14, { size: 8.5, font: 'bold' });

  const mx = C1 + 3;
  p.text('DATE', mx, T1 + 5, { size: 9, font: 'bold' });
  p.text(mmddyyyy(rec.pickupDate), mx + 42, T1 + 5, { size: 9 });
  p.text('MM / DD / YYYY', mx + 42, T1 + 16, { size: 4.5 });
  p.text('BOL', mx, T1 + 25, { size: 9, font: 'bold' }); p.text(rec.bolNumber, mx + 42, T1 + 25, { size: 9 });
  p.text('QUOTE', mx, T1 + 40, { size: 9, font: 'bold' }); p.text('ID', mx, T1 + 49, { size: 9, font: 'bold' });
  p.text(rec.quote.quoteNumber, mx + 42, T1 + 40, { size: 9 });
  p.box(mx, T1 + 58, 202, 28);
  p.text('SALES ORDER    {PURCHASE ORDER}', mx + 3, T1 + 61, { size: 8.5, font: 'bold' });
  p.text(`${rec.salesOrder.number}    {${rec.salesOrder.po || ''}}`, mx + 3, T1 + 74, { size: 8, maxWidth: 196 });
  p.text('RMA #', mx, T1 + 91, { size: 9, font: 'bold' }); p.text(rec.rmaNumber, mx + 42, T1 + 91, { size: 9, font: 'bold' });
  p.text('PRONUM', mx, T1 + 106, { size: 9, font: 'bold' });
  const bc = await doc.embedPng(await code39Png(rec.proNumber));
  const bw = Math.min(200, bc.width * 0.35), bh = 34;
  p.image(bc, (C1 + C2) / 2 - bw / 2, T1 + 118, bw, bh);
  p.center(rec.proNumber, (C1 + C2) / 2, T1 + 155, { size: 10 });

  const rx = C2 + 4;
  p.text('CARRIER', rx, T1 + 5, { size: 9, font: 'bold' });
  p.text(CARRIER.short, rx + 52, T1 + 4, { size: 8, font: 'bold' });
  p.text(CARRIER.serviceLevel, rx + 52, T1 + 13, { size: 7.5 });
  p.text('FREIGHT TERMS', rx, T1 + 27, { size: 9, font: 'bold' });
  y = T1 + 44;
  for (const a of rec.accessorials) { p.text(ACCESSORIAL_LABELS[a] || a, rx, y, { size: 9 }); y += 11; }

  // ---- block 2: SHIP TO | BILL TO | PURCHASER / ULTIMATE CONSIGNEE
  const T2 = T1 + H1, H2 = 97;
  p.box(L, T2, R - L, H2);
  p.line(C1, T2, C1, T2 + H2); p.line(C2, T2, C2, T2 + H2); p.line(L, T2 + 15, R, T2 + 15);
  p.text('SHIP TO / CONSIGNEE', L + 8, T2 + 4, { size: 8.5, font: 'bold' });
  p.text('BILL TO', C1 + 8, T2 + 4, { size: 8.5, font: 'bold' });
  p.text('PURCHASER / ULTIMATE CONSIGNEE', C2 + 4, T2 + 4, { size: 8.5, font: 'bold' });
  const col = (lines, x, w) => { let yy = T2 + 22; for (const s of lines) { p.text(s, x, yy, { size: 9, maxWidth: w }); yy += 11.5; } };
  const wh = addrLines(rec.shipTo);
  col(wh, L + 6, C1 - L - 10);
  col(rec.billTo.lines, C1 + 6, C2 - C1 - 10);
  col(wh, C2 + 4, R - C2 - 8);

  // ---- package table
  const T3 = T2 + H2 + 5;
  const X = [L, 96, 167, 216, 260, 476, 539, R];
  const rowH = 12, rows = rec.pallets.length;
  const tableH = rowH * (rows + 2);
  p.box(L, T3, R - L, tableH);
  p.line(L, T3 + rowH, R, T3 + rowH);
  p.line(L, T3 + rowH * (rows + 1), R, T3 + rowH * (rows + 1));
  for (const x of X.slice(1, -1)) p.line(x, T3, x, T3 + tableH);
  ['PACKAGES', 'LxWxH', 'HM', 'WT - LB', 'DESCRIPTION', 'NMFC', 'CLASS'].forEach((h, i) =>
    (i === 4 ? p.text(h, X[i] + 2, T3 + 2, { size: 8, font: 'bold' }) : p.center(h, (X[i] + X[i + 1]) / 2, T3 + 2, { size: 8, font: 'bold' })));
  rec.pallets.forEach((pl, i) => {
    const t = T3 + rowH * (i + 1) + 2;
    p.text(`1 - (${pl.type})`, L + 4, t, { size: 8.5 });
    p.text(`${pl.length}x${pl.width}x${pl.height}`, X[1] + 8, t, { size: 8.5 }); p.text('IN', X[2] - 12, t + 1, { size: 6 });
    p.right(fmtWt(pl.weightLb), X[4] - 3, t, { size: 8.5 });
    p.text(FREIGHT.commodity, X[4] + 2, t, { size: 8.5 });
    p.text(pl.nmfc, X[5] + 3, t, { size: 8.5 });
    p.text(pl.freightClass, X[6] + 3, t, { size: 8.5 });
  });
  const tt = T3 + rowH * (rows + 1) + 2;
  p.text(String(rec.totals.pallets), L + 4, tt, { size: 8.5 });
  p.center('<<    TOTALS    >>', (X[1] + X[3]) / 2, tt, { size: 8, font: 'bold' });
  p.right(fmtWt(rec.totals.weightLb), X[4] - 3, tt, { size: 8.5 });

  // ---- pickup instructions + prepared by
  const T4 = T3 + tableH;
  p.box(L, T4, R - L, 34);
  p.text('PICKUP INSTRUCTIONS:', L + 3, T4 + 3, { size: 8, font: 'bold' });
  p.text(`Call customer before pickup: ${rec.shipFrom.phone}`, L + 6, T4 + 13, { size: 8.5 });
  const days = [rec.pickupDate, ...(rec.altDates || [])].map((d) => mmddyyyy(d).slice(0, 5)).join(', ');
  p.text(`Pickup ${FREIGHT.pickupWindow.label} only. Customer available: ${days}`, L + 6, T4 + 24, { size: 7.5, maxWidth: 280 });
  p.text(`Prepared by: ${rec.repName}`, 300, T4 + 3, { size: 7.5 });
  p.text(rec.csContact.line, 300, T4 + 14, { size: 7, maxWidth: R - 304 });

  // ---- legal
  const T5 = T4 + 40, mid = 292;
  p.box(L, T5, R - L, 56); p.line(mid, T5, mid, T5 + 56);
  p.para(LEGAL.declaredValue, L + 3, T5 + 3, mid - L - 6);
  p.text(LEGAL.declaredBlank, L + 12, T5 + 38, { size: 6.3 });
  const hRec = p.para(LEGAL.recourse, mid + 3, T5 + 3, R - mid - 6);
  p.text(LEGAL.recourseSig, mid + 3, T5 + 4 + hRec, { size: 6.3 });
  const T6 = T5 + 59;
  p.box(L, T6, R - L, 70);
  p.para(LEGAL.received, L + 3, T6 + 3, R - L - 6);
  const T7 = T6 + 73;
  p.box(L, T7, R - L, 22);
  p.para(LEGAL.dot, L + 3, T7 + 3, R - L - 6);

  // ---- signatures
  const T8 = T7 + 27;
  p.line(283, T8, 283, T8 + 32);
  p.text('SHIPPER', L + 3, T8 + 2, { size: 7.5, font: 'bold' }); p.text(rec.shipFrom.name, L + 3, T8 + 16, { size: 7.5 });
  p.text('CARRIER', 300, T8 + 2, { size: 7.5, font: 'bold' }); p.text(CARRIER.name, 300, T8 + 16, { size: 7.5 });
  p.line(L, T8 + 32, R, T8 + 32, 0.5);
  p.text('Signature / Date', L + 3, T8 + 35, { size: 5.5 }); p.text('Signature / Date', 300, T8 + 35, { size: 5.5 });
  p.text('Return BOL.Acme-FRP', 535, T8 - 4, { size: 4.5 });

  if (rec.mock) mockWatermark(page, fonts);
  return doc.save();
}
