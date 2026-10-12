// Packing List, mirroring Acme's PaceJet packing list (letter), adapted for returns:
// FROM = customer, SHIP TO = Acme warehouse, plus an RMA # row.
import { newDoc, painter, drawLogo, mockWatermark, mmddyyyy, fmtWt, addrLines, BLUE } from './common.mjs';
import { CARRIER } from '../../config/app-config.mjs';

const L = 20, R = 588;

export async function drawPackingList(doc, fonts, logo, rec) {
  const page = doc.addPage([612, 792]);
  const p = painter(page, fonts);

  drawLogo(p, logo, L, 26, 135);
  p.center('Packing List', 330, 34, { size: 18, font: 'bold', color: BLUE });

  // ---- FROM / SHIP TO (left)
  const block = (title, lines, top) => {
    p.text(title, L, top, { size: 10, font: 'bold' });
    p.line(L, top + 12, 258, top + 12);
    let y = top + 16;
    for (const s of lines) { p.text(s, L + 2, y, { size: 9, maxWidth: 236 }); y += 11.5; }
    return y;
  };
  const yAfterFrom = block('FROM', addrLines(rec.shipFrom), 84);
  const yLeft = block('SHIP TO', addrLines(rec.shipTo), Math.max(yAfterFrom + 6, 152));

  // ---- info box (right)
  const X0 = 262, X1 = 357, X2 = 466, X3 = R, T = 84;
  const rows = [
    ['TRANSACTION ID', rec.bolNumber, 16],
    ['CARRIER &\nCLASS', `${CARRIER.short} - ${CARRIER.serviceLevel}`, 24],
    ['FREIGHT TERMS', 'PREPAID', 15],
    ['MSTR TRACKID', rec.proNumber, 15],
    ['RMA #', rec.rmaNumber, 15],
  ];
  let y = T;
  for (const [label, value, h] of rows) {
    p.box(X0, y, X2 - X0, h);
    p.line(X1, y, X1, y + h);
    label.split('\n').forEach((part, i) => p.text(part, X0 + 3, y + 3 + i * 10, { size: 8.5, font: 'bold' }));
    p.text(value, X1 + 3, y + 3, { size: 8.5, maxWidth: X2 - X1 - 6 });
    y += h;
  }
  // ORDER DATES
  p.box(X2, T, X3 - X2, 40 + 15);
  p.right('ORDER DATES', X3 - 3, T + 2, { size: 8.5, font: 'bold' });
  p.right('(MM/dd/yyyy)', X3 - 3, T + 12, { size: 6, font: 'boldIt' });
  p.line(X2, T + 22, X3, T + 22);
  p.text('ORDER', X2 + 3, T + 27, { size: 8.5, font: 'bold' });
  p.text(rec.salesOrder.orderDate ? mmddyyyy(rec.salesOrder.orderDate) : '', X2 + 50, T + 27, { size: 8.5 });
  p.line(X2, T + 40, X3, T + 40);
  p.text('PICKUP', X2 + 3, T + 43, { size: 8.5, font: 'bold' });
  p.text(mmddyyyy(rec.pickupDate), X2 + 50, T + 43, { size: 8.5 });
  // SALES ORDER / PURCHASE ORDER
  p.box(X0, y, X3 - X0, 30);
  p.text('SALES ORDER', X0 + 30, y + 3, { size: 8.5, font: 'bold' });
  p.text('PURCHASE ORDER', X0 + 150, y + 3, { size: 8.5, font: 'bold' });
  p.text(rec.salesOrder.number, X0 + 44, y + 16, { size: 8 });
  p.text(rec.salesOrder.po || '', X0 + 150, y + 16, { size: 8, maxWidth: X3 - X0 - 155 });

  // ---- item table, grouped by container
  const TT = Math.max(y + 44, yLeft + 10, 232);
  const C = { cont: L + 8, so: 108, sku: 188, desc: 310, qty: R - 3 };
  p.text('CONTAINER', C.cont, TT + 3, { size: 9.5, font: 'bold' });
  p.text('SO', C.so, TT + 3, { size: 9.5, font: 'bold' });
  p.text('PRODUCT', C.sku, TT + 3, { size: 9.5, font: 'bold' });
  p.text('DESCRIPTION', C.desc, TT + 3, { size: 9.5, font: 'bold' });
  p.right('QTY', C.qty, TT + 3, { size: 9.5, font: 'bold' });
  p.line(L, TT + 16, R, TT + 16);
  y = TT + 19;
  rec.pallets.forEach((pl, i) => {
    if (i) y += 3;
    p.text(`#${i + 1} - ${pl.type}  ${pl.length}x${pl.width}x${pl.height} (${fmtWt(pl.weightLb)}-LB)`, L + 2, y, { size: 7.5, font: 'boldIt' });
    p.text(`Track ID:${rec.proNumber}`, C.desc, y, { size: 7.5, font: 'boldIt' });
    y += 11;
    for (const it of pl.items) {
      p.line(C.so - 4, y - 1, R, y - 1, 0.5);
      p.text(rec.salesOrder.number, C.so, y, { size: 8.5 });
      p.text(it.sku, C.sku, y, { size: 8.5, maxWidth: C.desc - C.sku - 6 });
      p.text(it.description, C.desc, y, { size: 8.5, maxWidth: 230 });
      p.right(`${it.qty} Each`, C.qty, y + 1, { size: 7.5 });
      y += 11;
    }
  });
  p.line(L, y + 1, R, y + 1, 1.6);
  const ft = y + 6;
  p.text(String(rec.totals.pallets), L + 2, ft, { size: 9, font: 'bold' });
  p.text(`${fmtWt(rec.totals.weightLb)}-LB`, L + 2, ft + 11, { size: 9, font: 'bold' });
  p.text('<< COUNT', C.so, ft + 1, { size: 8.5, font: 'bold' });
  p.text('<< WEIGHT', C.so, ft + 13, { size: 8.5, font: 'bold' });
  p.text('TOTAL', 297, ft + 1, { size: 8.5, font: 'bold' });
  p.text('QTY SHIPPED > >', 436, ft + 1, { size: 8.5, font: 'bold' });
  p.right(`${rec.totals.qty} Each`, C.qty, ft, { size: 8.5, font: 'bold' });
  p.box(L, TT, R - L, ft + 26 - TT);

  if (rec.mock) mockWatermark(page, fonts);
  return page;
}

export async function renderPackingList(rec) {
  const { doc, fonts, logo } = await newDoc();
  await drawPackingList(doc, fonts, logo, rec);
  return doc.save();
}
