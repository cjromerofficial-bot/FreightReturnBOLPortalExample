// Phase 1 scenarios, run in MOCK MODE:  npm test
// Writes rendered BOLs to test-output/ for visual comparison with the PaceJet examples.
import './_env.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resetMemoryStore } from '../lib/store.mjs';
import { lookup, quote, createBol } from '../lib/returns.mjs';
import { prefillPallets, densityPcf, totals, nextBusinessDay, todayIso, suggestClass, earliestPickupDate } from '../lib/freight.mjs';
import { renderBol } from '../lib/pdf/bol.mjs';
import { code39Png } from '../lib/pdf/common.mjs';
import { decodeCode39 } from './code39-decode.mjs';
import createBolFn from '../api/create-bol.mjs';

const Acme = 'Test Rep';
const ALL_CHECKED = { address: true, items: true, dimensions: true, freightClass: true, destination: true };
fs.mkdirSync('test-output', { recursive: true });
beforeEach(() => { resetMemoryStore(); delete process.env.MOCK_RL_BOL_FAIL; delete process.env.MOCK_RL_DELAY_MS; });

async function prepare(rma, dest, classes) {
  const data = await lookup(rma);
  const pallets = prefillPallets(data).map((p, i) => (classes[i] ? { ...p, freightClass: classes[i][0], nmfc: classes[i][1], classManual: true } : p));
  const shipment = {
    rmaNumber: data.rma.number, destination: dest, pickupDate: earliestPickupDate(todayIso()),
    accessorials: { liftgate: !!data.customer.residential, limitedAccess: false, insidePickup: false }, pallets,
  };
  return { data, shipment };
}
const sid = () => `test-${Math.random().toString(36).slice(2)}-${Date.now()}`;

test('(a) residential single pallet to CA — 48x40x60, 718 lb', async () => {
  const { data, shipment } = await prepare('rma100001', 'CA', [['92.5', '015520-07']]);
  assert.equal(totals(shipment, data.rma.lines).weightLb, 718);
  assert.equal(densityPcf(718, 48, 40, 60), 10.77); // 718 / (115200/1728 = 66.667 ft³)
  assert.equal(shipment.accessorials.liftgate, true, 'liftgate defaults ON for residential');
  const q = await quote({ shipment, repName: Acme });
  const rec = await createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED });
  assert.deepEqual(rec.accessorials, ['ResidentialPickup', 'OriginLiftgate']);
  assert.equal(rec.quote.quoteNumber, q.quoteNumber, 'BOL references the quote');
  assert.equal(rec.totals.weightLb, 718);
  assert.equal(rec.shipTo.zip, '92501');
  fs.writeFileSync('test-output/BOL_a_residential_CA.pdf', await renderBol(rec));
});

test('(b) two pallets to PA — 96x40x20 @ 691.6 lb and 48x40x60 @ 1,003 lb', async () => {
  const { data, shipment } = await prepare('RMA100002', 'PA', [['70', '015520-09'], ['70', '015520-09']]);
  const t = totals(shipment, data.rma.lines);
  assert.equal(t.weightLb, 1694.6);
  assert.equal(t.qty, 2); // uprights + Titan base
  assert.equal(densityPcf(691.6, 96, 40, 20), 15.56); // 691.6 / 44.444 ft³
  assert.ok(Math.abs(densityPcf(1003, 48, 40, 60) - 15.045) <= 0.006); // 1003 / 66.667 ft³ = 15.045
  assert.equal(shipment.accessorials.liftgate, false, 'commercial: liftgate defaults OFF');
  const q = await quote({ shipment, repName: Acme });
  const rec = await createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED });
  assert.equal(rec.pallets.length, 2);
  assert.deepEqual(rec.pallets.map((p) => p.weightLb).sort((a, b) => a - b), [691.6, 1003]);
  fs.writeFileSync('test-output/BOL_b_two_pallets_PA.pdf', await renderBol(rec));
});

test('(c) customer sourced a new pallet — overridden dims and weight', async () => {
  const { shipment } = await prepare('RMA100003', 'CA', [['85', '015520-08']]);
  Object.assign(shipment.pallets[0], { length: 73, width: 46, height: 33 }); // customer used a 73x46x33 pallet instead of 48x40x48
  const q = await quote({ shipment, repName: Acme });
  const rec = await createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED });
  assert.equal(rec.pallets[0].length, 73); assert.equal(rec.pallets[0].height, 33);
  assert.equal(rec.pallets[0].weightLb, 360, 'weight always = item weights; rep is never asked');
  assert.equal(rec.pallets[0].densityPcf, densityPcf(360, 73, 46, 33));
  fs.writeFileSync('test-output/BOL_c_override.pdf', await renderBol(rec));
});

test('(c2) changing anything after the quote forces a new quote', async () => {
  const { shipment } = await prepare('RMA100003', 'CA', [['85', '015520-08']]);
  const q = await quote({ shipment, repName: Acme });
  shipment.pallets[0].height = 60;
  await assert.rejects(createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED }), /Get Quote/);
});

test('(d) double-clicked submit creates exactly one BOL', async () => {
  process.env.MOCK_RL_DELAY_MS = '50';
  const { shipment } = await prepare('RMA100001', 'CA', [['92.5', '015520-07']]);
  const q = await quote({ shipment, repName: Acme });
  const body = JSON.stringify({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED });
  const call = () => createBolFn(new Request('http://x/api/create-bol', { method: 'POST', body }));
  const [r1, r2] = await Promise.all([call(), call()]);
  const statuses = [r1.status, r2.status].sort();
  assert.deepEqual(statuses, [200, 409], 'second click is told the first is in progress');
  // A retry with the same submission returns the SAME BOL, not a new one.
  const r3 = await call();
  const first = await (r1.status === 200 ? r1 : r2).json();
  const third = await r3.json();
  assert.equal(r3.status, 200); assert.equal(third.proNumber, first.proNumber); assert.equal(third.replayed, true);
  // A brand-new submission for the same RMA is refused.
  const r4 = await createBolFn(new Request('http://x/api/create-bol', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), submissionId: sid() }) }));
  assert.equal(r4.status, 409);
  assert.match((await r4.json()).error, /already has a BOL/);
  // And lookup warns about the existing BOL.
  assert.equal((await lookup('RMA100001')).existingBol.proNumber, first.proNumber);
});

test('(d2) R+L rejection releases the lock; a timeout does not (no duplicate risk)', async () => {
  const { shipment } = await prepare('RMA100002', 'CA', [['70', '015520-09'], ['70', '015520-09']]);
  const q = await quote({ shipment, repName: Acme });
  process.env.MOCK_RL_BOL_FAIL = 'reject';
  await assert.rejects(createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED }), /safe to fix and try again/);
  process.env.MOCK_RL_BOL_FAIL = 'timeout';
  await assert.rejects(createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED }), /Don't retry/);
  delete process.env.MOCK_RL_BOL_FAIL;
  await assert.rejects(createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL_CHECKED }), /couldn't confirm/);
});


test('(f) RMA that does not exist / has no items', async () => {
  await assert.rejects(lookup('RMA999999'), (e) => e.status === 404 && /couldn't find RMA999999/.test(e.message));
  await assert.rejects(lookup('RMA100004'), (e) => e.status === 422 && /no items/.test(e.message));
  await assert.rejects(lookup('!!'), /doesn't look like an RMA/);
});

test('guardrails: over-assigning, unconfirmed class, weekend date', async () => {
  const { shipment } = await prepare('RMA100001', 'CA', [['92.5', '015520-07']]);
  shipment.pallets[0].items[0].qty = 2;
  await assert.rejects(quote({ shipment, repName: Acme }), /only has 1/);
  shipment.pallets[0].items[0].qty = 1;
  shipment.pallets[0].freightClass = '';
  await assert.rejects(quote({ shipment, repName: Acme }), /needs a freight class/);
  shipment.pallets[0].freightClass = '92.5';
  shipment.pickupDate = '2026-10-10'; // Saturday
  await assert.rejects(quote({ shipment, repName: Acme }), /weekend|too soon/);
});

test('density table suggests the right NMFC sub and class', () => {
  assert.deepEqual(suggestClass(10.77), { nmfc: '015520-07', freightClass: '92.5', range: suggestClass(10.77).range }); // Helms
  assert.equal(suggestClass(15.56).nmfc, '015520-09'); assert.equal(suggestClass(15.56).freightClass, '70'); // Lusk pallet 1
  assert.equal(suggestClass(15.04).freightClass, '70'); // Lusk pallet 2
  assert.equal(suggestClass(12).freightClass, '85', '12 is the start of sub 8 (lower bound inclusive)');
  assert.equal(suggestClass(0.5).freightClass, '400');
  assert.equal(suggestClass(75).nmfc, '015520-13');
  assert.equal(suggestClass(0), null);
});

test('barcodes encode the PRO number', async () => {
  for (const pro of ['123456789', '476556905', 'WD3012858', 'I111111111']) assert.equal(decodeCode39(await code39Png(pro)), pro);
});
