// Smart pallet guess + original BOL / packing list reader. Synthetic data only (no customer info).
import './_env.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { suggestPallets } from '../lib/packaging.mjs';
import { parseShipmentDoc, palletsFromDoc, pdfLines } from '../lib/docparse.mjs';
import parseDocFn from '../routes/parse-doc.mjs';

const L = (lineId, sku, description, qty = 1) => ({ lineId, sku, description, qty, unitWeightLb: 10 });
const dims = (p) => `${p.type} ${p.length}x${p.width}x${p.height}`;

test('guess: Titan 2.0 base & stacks get their own crate, the rest goes on a 96" pallet', () => {
  const p = suggestPallets([
    L('1', 'PR-5000-UP-80-MBLK', 'PR-5000 Uprights Pair - 80"', 3),
    L('2', 'PRA-FT-DUAL-5003-S', 'Titan 2.0 Base and Weight Stacks - 5000 Series - No Trolleys'),
    L('3', 'FTA-5040-PS', 'Cable Attachment - Straight Bar Pro Style'),
  ]);
  assert.deepEqual(p.map(dims), ['Crate 48x40x60', 'Pallet 96x40x20']);
  assert.deepEqual(p[0].items, [{ lineId: '2', qty: 1 }]);
  assert.deepEqual(p[1].items, [{ lineId: '1', qty: 3 }, { lineId: '3', qty: 1 }]);
  assert.match(p[0].reason, /own crate/);
});

test('guess: dumbbell set + its rack share a crate; treadmill gets a 73" pallet; plain order = one 96" pallet', () => {
  assert.deepEqual(suggestPallets([L('1', 'DBS-3000-550', 'Rubber Hex Dumbbell Set 5-50lb'), L('2', 'WS-5100', 'DB Storage Rack - Black')]).map(dims), ['Crate 48x40x60']);
  assert.deepEqual(suggestPallets([L('1', 'TM-1', 'Some Treadmill'), L('2', 'BB-1120', 'Delta Basic Bar')]).map(dims), ['Pallet 73x46x33', 'Pallet 96x40x20']);
  const plain = suggestPallets([L('1', 'BB-1120', 'Delta Basic Bar'), L('2', 'BP-1000-45', 'Bumper Plates', 2)]);
  assert.deepEqual(plain.map(dims), ['Pallet 96x40x20']);
  assert.match(plain[0].reason, /almost always/);
  // Two Titan units -> two crates.
  assert.equal(suggestPallets([L('1', 'PRA-FT-DUAL-5003-S', 'Titan 2.0 Base and Weight Stacks', 2)]).length, 2);
});

// Lines shaped exactly like pdf.js output of PaceJet documents (values made up).
const BOL_LINES = [
  ' | STRAIGHT BILL OF LADING - SHORT FORM - Original Not Negotiable',
  'BOL | IF9990001', 'SO9990001 | {123}', '*555000111*',
  'PACKAGES | LxWxH | HM | WT - LB | DESCRIPTION | NMFC | CLASS',
  '1 - (Pallet) | 96x40x20 | IN | 1,177.6 | Home Gym Equipment | 015520-10 | 65',
  '1 - (Pallet) | 48x40x60 | IN | 1,003.0 | Home Gym Equipment | 015520-09 | 70',
  '2 | << | TOTALS | >> | 2,180.6',
];
const PACK_LINES = [
  'Packing List', 'TRANSACTION ID | IF9990001', 'MSTR TRACKID | 555000111', 'SO9990001 | 123',
  'CONTAINER | SO | PRODUCT | DESCRIPTION | QTY',
  '#1 - Pallet 96x40x20 (620.4-LB) | Track ID:555000111',
  'SO9990001 | BB-1120 | Delta Basic Bar, 20kg | 1 | Ea',
  'SO9990001 | PRA-FT-DUAL-5002-S- | Titan 2.0 Trolley Pair - 5000 Series - Standard | 1 | Ea',
  'SO9990001 | BP-1000-45 | Bumper Plates - Black - Single - 45 lb | 2 | Ea',
  '#2 - Pallet 48x40x60 (1003.0-LB) | Track ID:555000111',
  'SO9990001 | PRA-FT-DUAL-5003-S | Titan 2.0 Base and Weight Stacks - 5000 Series | 1 | Ea',
];
const RMA = [
  L('1', 'PRA-FT-DUAL-5003-S', 'Titan 2.0 Base and Weight Stacks - 5000 Series'),
  L('2', 'PRA-FT-DUAL-5002-S-TROLLEY', 'Titan 2.0 Trolley Pair'),
  L('3', 'BP-1000-45', 'Bumper Plates - Black - Single - 45 lb', 2),
];

test('read a PaceJet BOL: sizes, weights, class, IF#, SO, PRO', () => {
  const d = parseShipmentDoc(BOL_LINES);
  assert.equal(d.kind, 'bol');
  assert.deepEqual([d.ifNumber, d.salesOrder, d.pro], ['IF9990001', 'SO9990001', '555000111']);
  assert.deepEqual(d.containers.map((c) => [c.length, c.width, c.height, c.weightLb, c.nmfc, c.freightClass]), [[96, 40, 20, 1177.6, '015520-10', '65'], [48, 40, 60, 1003, '015520-09', '70']]);
});

test('BOL only: items placed by size match (PaceJet calls the crate a "Pallet")', () => {
  const { pallets } = palletsFromDoc(parseShipmentDoc(BOL_LINES), RMA, suggestPallets);
  const crate = pallets.find((p) => p.length === 48);
  assert.deepEqual(crate.items, [{ lineId: '1', qty: 1 }], 'Titan base went to the 48x40x60');
  assert.deepEqual(pallets.find((p) => p.length === 96).items.map((i) => i.lineId).sort(), ['2', '3']);
});

test('packing list: RMA items go on the container they shipped on; partial returns drop unused containers', () => {
  const d = parseShipmentDoc(PACK_LINES);
  assert.equal(d.kind, 'packing-list');
  assert.equal(d.containers[0].items.length, 3);
  const { pallets, unmatched } = palletsFromDoc(d, RMA, suggestPallets);
  assert.deepEqual(unmatched, []);
  assert.deepEqual(pallets.find((p) => p.length === 96).items, [{ lineId: '2', qty: 1 }, { lineId: '3', qty: 2 }], 'truncated SKU "…-S-" still matched');
  assert.deepEqual(pallets.find((p) => p.length === 48).items, [{ lineId: '1', qty: 1 }]);

  const onlyBase = palletsFromDoc(d, [RMA[0]], suggestPallets);
  assert.equal(onlyBase.pallets.length, 1, 'customer only returning the Titan base -> just the crate');
  assert.equal(onlyBase.dropped, 1);

  const extra = palletsFromDoc(d, [...RMA, L('9', 'XYZ-1', 'Not on the original')], suggestPallets);
  assert.deepEqual(extra.unmatched, ['XYZ-1']);
  assert.ok(extra.pallets.find((p) => p.length === 96).items.some((i) => i.lineId === '9'), 'unmatched item lands on the biggest pallet');
});

async function fakePaceJetPdf(lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  lines.forEach((line, i) => line.split(' | ').forEach((cell, j) => page.drawText(cell, { x: 20 + j * 95, y: 760 - i * 14, size: 8, font })));
  return Buffer.from(await doc.save());
}

test('end to end: a PDF through pdf.js and the /api/parse-doc endpoint', async () => {
  const pdf = await fakePaceJetPdf(BOL_LINES);
  assert.equal(parseShipmentDoc(await pdfLines(pdf)).containers.length, 2);
  const res = await parseDocFn(new Request('http://x/api/parse-doc?rma=RMA100002', { method: 'POST', body: pdf }));
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.deepEqual(body.pallets.map((p) => `${p.length}x${p.width}x${p.height}`).sort(), ['48x40x60', '96x40x20']);
  assert.equal(body.pallets.find((p) => p.length === 48).freightClass, '70', 'class filled from density');
  const bad = await parseDocFn(new Request('http://x/api/parse-doc?rma=RMA100002', { method: 'POST', body: Buffer.from('hello') }));
  assert.equal(bad.status, 400);
});
