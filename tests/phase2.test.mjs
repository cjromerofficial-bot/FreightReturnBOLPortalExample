// Phase 2 scenarios (MOCK MODE): pickup scheduling + documents.  npm test
import './_env.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { resetMemoryStore } from '../lib/store.mjs';
import { lookup, quote, createBol, retryPickup } from '../lib/returns.mjs';
import { prefillPallets, nextBusinessDay, todayIso, accessorialList, earliestPickupDate, addBusinessDays } from '../lib/freight.mjs';
import { renderPackingList } from '../lib/pdf/packing.mjs';
import { renderLabels4x6, renderLabelsLetter } from '../lib/pdf/label.mjs';
import { renderBundle } from '../lib/pdf/bundle.mjs';
import retryFn from '../routes/retry-pickup.mjs';

const Acme = 'Test Rep';
const ALL = { address: true, items: true, dimensions: true, freightClass: true, destination: true };
const sid = () => `t2-${Math.random().toString(36).slice(2)}-${Date.now()}`;
fs.mkdirSync('test-output', { recursive: true });
beforeEach(() => { resetMemoryStore(); for (const k of ['MOCK_RL_BOL_FAIL', 'MOCK_RL_PICKUP_FAIL', 'MOCK_RL_DELAY_MS']) delete process.env[k]; });

async function prepare(rma, dest, { schedule = true } = {}) {
  const data = await lookup(rma);
  return {
    data,
    shipment: {
      rmaNumber: data.rma.number, destination: dest, pickupDate: earliestPickupDate(todayIso()),
      accessorials: { residential: data.customer.residential, liftgate: data.customer.residential, limitedAccess: false, insidePickup: false },
      pickup: { schedule, readyTime: '09:00', closeTime: '17:00', contactName: data.customer.attn, contactPhone: data.customer.phone, instructions: 'Call 30 min before' },
      pallets: prefillPallets(data),
    },
  };
}
async function create(shipment) {
  const q = await quote({ shipment, repName: Acme });
  return createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL });
}

test('class/NMFC are pre-filled from the density table (no confirm click needed)', async () => {
  const { shipment } = await prepare('RMA100001', 'CA');
  assert.equal(shipment.pallets[0].freightClass, '92.5');
  assert.equal(shipment.pallets[0].nmfc, '015520-07');
  const two = await prepare('RMA100002', 'PA');
  assert.deepEqual(two.shipment.pallets.map((p) => [p.nmfc, p.freightClass]), [['015520-09', '70'], ['015520-09', '70']]);
});

test('residential checkbox drives the ResidentialPickup accessorial', async () => {
  const { data, shipment } = await prepare('RMA100001', 'CA');
  assert.deepEqual(accessorialList(shipment, data.customer), ['ResidentialPickup', 'OriginLiftgate']);
  shipment.accessorials.residential = false;
  assert.deepEqual(accessorialList(shipment, data.customer), ['OriginLiftgate']);
});

test('pickup scheduled together with the BOL', async () => {
  const { shipment } = await prepare('RMA100001', 'CA');
  const rec = await create(shipment);
  assert.equal(rec.pickup.status, 'scheduled');
  assert.match(rec.pickup.id, /^\d+$/);
});

test('(e) BOL succeeds but pickup fails -> BOL kept, retry only the pickup', async () => {
  const { shipment } = await prepare('RMA100002', 'PA');
  process.env.MOCK_RL_PICKUP_FAIL = 'reject';
  const rec = await create(shipment);
  assert.ok(rec.proNumber, 'BOL was created');
  assert.equal(rec.pickup.status, 'failed');
  assert.match(rec.pickup.error, /could not schedule/);
  delete process.env.MOCK_RL_PICKUP_FAIL;
  const after = await retryPickup({ bolNumber: rec.bolNumber, repName: Acme });
  assert.equal(after.pickup.status, 'scheduled');
  assert.equal(after.proNumber, rec.proNumber, 'same BOL, no second BOL created');
  // Retrying again returns the same pickup, never a second one.
  const again = await retryPickup({ bolNumber: rec.bolNumber, repName: Acme });
  assert.equal(again.pickup.id, after.pickup.id);
});

test('(e2) double-clicked pickup retry schedules exactly one pickup', async () => {
  const { shipment } = await prepare('RMA100003', 'CA');
  process.env.MOCK_RL_PICKUP_FAIL = 'reject';
  const rec = await create(shipment);
  delete process.env.MOCK_RL_PICKUP_FAIL;
  const body = JSON.stringify({ bolNumber: rec.bolNumber, repName: Acme });
  const call = () => retryFn(new Request('http://x/api/retry-pickup', { method: 'POST', body }));
  const res = await Promise.all([call(), call()]);
  const ok = await Promise.all(res.map((r) => r.json()));
  const ids = new Set(ok.filter((b) => b.pickup?.status === 'scheduled').map((b) => b.pickup.id));
  assert.equal(ids.size, 1);
  assert.ok(res.some((r) => r.status === 200));
});

test('pickup timeout -> marked unknown, retry blocked (no duplicate pickup)', async () => {
  const { shipment } = await prepare('RMA100001', 'CA');
  process.env.MOCK_RL_PICKUP_FAIL = 'timeout';
  const rec = await create(shipment);
  assert.equal(rec.pickup.status, 'unknown');
  delete process.env.MOCK_RL_PICKUP_FAIL;
  await assert.rejects(retryPickup({ bolNumber: rec.bolNumber, repName: Acme }), /Don't retry/);
});

test('schedule a pickup later when none was requested; pickup window validated', async () => {
  const { shipment } = await prepare('RMA100001', 'CA', { schedule: false });
  const rec = await create(shipment);
  assert.equal(rec.pickup.status, 'not-requested');
  await assert.rejects(retryPickup({ bolNumber: rec.bolNumber, repName: Acme, pickup: { contactName: 'X', contactPhone: '555' } }), /10-digit/);
  const done = await retryPickup({ bolNumber: rec.bolNumber, repName: Acme, pickup: { readyTime: '10:00', closeTime: '16:00', contactName: 'X', contactPhone: '5555555555' } });
  assert.equal(done.pickup.status, 'scheduled');
});

test('pickup dates: 2 business days notice, weekdays only, 1-3 distinct days', async () => {
  const { shipment } = await prepare('RMA100001', 'CA', { schedule: false });
  const today = todayIso();
  const tomorrow = nextBusinessDay(today);
  await assert.rejects(quote({ shipment: { ...shipment, pickupDate: tomorrow }, repName: Acme }), /too soon.*2 business days/);
  let sat = earliestPickupDate(today); while (new Date(sat + 'T12:00Z').getUTCDay() !== 6) sat = new Date(Date.parse(sat + 'T12:00Z') + 86400000).toISOString().slice(0, 10);
  await assert.rejects(quote({ shipment: { ...shipment, altDates: [sat] }, repName: Acme }), /Alternate date 1 is a weekend/);
  await assert.rejects(quote({ shipment: { ...shipment, altDates: [shipment.pickupDate] }, repName: Acme }), /different day/);
  const d2 = addBusinessDays(shipment.pickupDate, 1), d3 = addBusinessDays(shipment.pickupDate, 2);
  await assert.rejects(quote({ shipment: { ...shipment, altDates: [d2, d3, addBusinessDays(d3, 1)] }, repName: Acme }), /at most 3/);
  const ok = await quote({ shipment: { ...shipment, altDates: [d2, d3] }, repName: Acme });
  assert.ok(ok.quoteNumber);
});

test('pickup is always 1-5 PM and alternate dates are sent to R+L', async () => {
  const { shipment } = await prepare('RMA100002', 'PA');
  shipment.altDates = [addBusinessDays(shipment.pickupDate, 1)];
  const rec = await create(shipment);
  assert.equal(rec.pickup.readyTime, '13:00');
  assert.equal(rec.pickup.closeTime, '17:00');
  const [, m, d] = shipment.altDates[0].split('-');
  assert.ok(rec.pickup.instructions.includes(`CUSTOMER ALSO AVAILABLE ${m}/${d} (1-5 PM)`), rec.pickup.instructions);
  assert.deepEqual(rec.altDates, shipment.altDates);
});

test('documents: packing list, 4x6 + letter labels (one per pallet), bundle', async () => {
  const { shipment } = await prepare('RMA100002', 'PA');
  const rec = await create(shipment);
  const files = {
    'PackingList_b_two_pallets.pdf': await renderPackingList(rec),
    'Labels4x6_b_two_pallets.pdf': await renderLabels4x6(rec),
    'LabelsLetter_b_two_pallets.pdf': await renderLabelsLetter(rec),
    'Bundle_b_two_pallets.pdf': await renderBundle(rec),
  };
  for (const [f, b] of Object.entries(files)) fs.writeFileSync(`test-output/${f}`, b);
  const pages = async (b) => (await PDFDocument.load(b)).getPages();
  const lbl = await pages(files['Labels4x6_b_two_pallets.pdf']);
  assert.equal(lbl.length, 2, 'one 4x6 label per pallet');
  assert.deepEqual([Math.round(lbl[0].getWidth()), Math.round(lbl[0].getHeight())], [288, 432], '4x6 inches');
  assert.equal((await pages(files['LabelsLetter_b_two_pallets.pdf'])).length, 2);
  assert.equal((await pages(files['Bundle_b_two_pallets.pdf'])).length, 1 + 1 + 2, 'BOL + packing list + 2 labels');

  const one = await create((await prepare('RMA100001', 'CA')).shipment);
  fs.writeFileSync('test-output/PackingList_a_residential.pdf', await renderPackingList(one));
  fs.writeFileSync('test-output/Labels4x6_a_residential.pdf', await renderLabels4x6(one));
  fs.writeFileSync('test-output/Bundle_a_residential.pdf', await renderBundle(one));
});
