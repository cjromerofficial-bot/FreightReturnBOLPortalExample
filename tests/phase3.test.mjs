// Phase 3 scenarios (MOCK MODE): NetSuite write-back, history, void + Duplicate & edit.
import './_env.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resetMemoryStore } from '../lib/store.mjs';
import { lookup, quote, createBol, retryPickup, retryWriteBack, voidBol, history, getRecord } from '../lib/returns.mjs';
import { mockRmaWrites, RMA_FIELDS } from '../lib/netsuite.mjs';
import { prefillPallets, nextBusinessDay, todayIso, earliestPickupDate } from '../lib/freight.mjs';

const Acme = 'Test Rep';
const ALL = { address: true, items: true, dimensions: true, freightClass: true, destination: true };
const sid = () => `t3-${Math.random().toString(36).slice(2)}-${Date.now()}`;
beforeEach(() => {
  resetMemoryStore(); mockRmaWrites.clear();
  for (const k of ['MOCK_RL_BOL_FAIL', 'MOCK_RL_PICKUP_FAIL', 'MOCK_NS_WRITE_FAIL', 'MOCK_RL_CANCEL_FAIL']) delete process.env[k];
});

async function prepare(rma, { schedule = false, dest = 'CA' } = {}) {
  const data = await lookup(rma);
  return {
    rmaNumber: data.rma.number, destination: dest, pickupDate: earliestPickupDate(todayIso()),
    accessorials: { residential: data.customer.residential, liftgate: data.customer.residential, limitedAccess: false, insidePickup: false },
    pickup: { schedule, readyTime: '09:00', closeTime: '17:00', contactName: data.customer.attn, contactPhone: data.customer.phone, instructions: '' },
    pallets: prefillPallets(data),
  };
}
async function create(shipment, extra = {}) {
  const q = await quote({ shipment, repName: Acme });
  return createBol({ shipment, quoteNumber: q.quoteNumber, submissionId: sid(), repName: Acme, checklist: ALL, ...extra });
}

test('PRO and pickup # are saved to the RMA', async () => {
  const rec = await create(await prepare('RMA100001', { schedule: true }));
  assert.equal(rec.writeBack.status, 'saved');
  assert.deepEqual(mockRmaWrites.get('RMA100001'), { [RMA_FIELDS.pro()]: rec.proNumber, [RMA_FIELDS.pickup()]: rec.pickup.id });
});

test('write-back fails -> BOL kept, numbers shown, retry ONLY the write-back', async () => {
  process.env.MOCK_NS_WRITE_FAIL = '1';
  const rec = await create(await prepare('RMA100002', { dest: 'PA' }));
  assert.ok(rec.proNumber);
  assert.equal(rec.writeBack.status, 'failed');
  assert.match(rec.writeBack.error, /NetSuite/);
  delete process.env.MOCK_NS_WRITE_FAIL;
  const after = await retryWriteBack({ bolNumber: rec.bolNumber, repName: Acme });
  assert.equal(after.writeBack.status, 'saved');
  assert.equal(after.proNumber, rec.proNumber, 'same BOL');
});

test('pickup scheduled later is also written to the RMA', async () => {
  const rec = await create(await prepare('RMA100001'));
  assert.equal(mockRmaWrites.get('RMA100001')[RMA_FIELDS.pickup()], undefined);
  const after = await retryPickup({ bolNumber: rec.bolNumber, repName: Acme, pickup: { readyTime: '10:00', closeTime: '15:00', contactName: 'X', contactPhone: '5555555555' } });
  assert.equal(mockRmaWrites.get('RMA100001')[RMA_FIELDS.pickup()], after.pickup.id);
});

test('history search by RMA, PRO, customer and SO', async () => {
  const a = await create(await prepare('RMA100001'));
  await create(await prepare('RMA100002', { dest: 'PA' }));
  assert.equal((await history()).length, 2);
  assert.equal((await history({ q: 'rma100001' }))[0].bolNumber, a.bolNumber);
  assert.equal((await history({ q: a.proNumber })).length, 1);
  assert.equal((await history({ q: 'lusk' }))[0].rmaNumber, 'RMA100002');
  assert.equal((await history({ q: 'SO1000001' }))[0].rmaNumber, 'RMA100001');
  assert.equal((await history({ q: 'nobody' })).length, 0);
});

test('Duplicate & edit: void cancels the pickup, frees the RMA, replacement BOL links both ways', async () => {
  const orig = await create(await prepare('RMA100003', { schedule: true }));
  await assert.rejects(voidBol({ bolNumber: orig.bolNumber, repName: Acme, reason: 'x', confirmedRlVoid: false }), /ask R\+L to void/);
  const { record: voided } = await voidBol({ bolNumber: orig.bolNumber, repName: Acme, reason: 'Wrong pallet size', confirmedRlVoid: true });
  assert.equal(voided.status, 'voided');
  assert.equal(voided.pickup.status, 'cancelled');
  assert.equal((await lookup('RMA100003')).existingBol, null, 'RMA is free for the replacement');

  // The form is rebuilt from the voided BOL's saved input; the rep fixes the pallet size.
  const fixed = { ...voided.input, rmaNumber: 'RMA100003', pickup: { ...voided.input.pickup, schedule: false } };
  fixed.pallets = fixed.pallets.map((p) => ({ ...p, length: 73, width: 46, height: 33 }));
  const repl = await create(fixed, { replaces: orig.bolNumber });
  assert.equal(repl.bolNumber, 'RTN-RMA100003-2');
  assert.equal(repl.replaces, orig.bolNumber);
  assert.equal((await getRecord(orig.bolNumber)).replacedBy, repl.bolNumber);
  assert.equal(mockRmaWrites.get('RMA100003')[RMA_FIELDS.pro()], repl.proNumber, 'RMA now holds the new PRO');
});

test('void is blocked if the pickup cannot be cancelled (nothing voided)', async () => {
  const orig = await create(await prepare('RMA100001', { schedule: true }));
  process.env.MOCK_RL_CANCEL_FAIL = '1';
  await assert.rejects(voidBol({ bolNumber: orig.bolNumber, repName: Acme, reason: 'Wrong date', confirmedRlVoid: true }), /nothing was voided/);
  assert.equal((await getRecord(orig.bolNumber)).status, 'active');
  assert.equal((await lookup('RMA100001')).existingBol.proNumber, orig.proNumber, 'RMA still locked to the original');
});

test('a replacement cannot skip voiding, and an active BOL still blocks a second one', async () => {
  const orig = await create(await prepare('RMA100001'));
  const again = await prepare('RMA100001');
  await assert.rejects(create(again, { replaces: orig.bolNumber }), /voided first|already has a BOL/);
  await assert.rejects(create(again), /already has a BOL/);
});
