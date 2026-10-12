// Core workflow: quote and create BOL, with server-side guardrails.
import crypto from 'node:crypto';
import { store } from './store.mjs';
import { RepError, isMock } from './http.mjs';
import { lookupRma, normalizeRma, writeRmaFields } from './netsuite.mjs';
import * as rl from './rl.mjs';
import { validateShipment, validatePickup, quoteInputs, totals, palletWeight, densityPcf } from './freight.mjs';
import { WAREHOUSES, BILL_TO, CS_CONTACT, RETENTION_DAYS, FREIGHT } from '../config/app-config.mjs';

const hash = (o) => crypto.createHash('sha256').update(JSON.stringify(o)).digest('hex');
const PENDING_STALE_MS = 3 * 60 * 1000;

export async function logEvent(type, data) {
  const at = new Date().toISOString();
  await store().set(`log/${at}-${crypto.randomBytes(3).toString('hex')}`, {
    type, at, ...data, purgeAfter: new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString(),
  });
}

/** Look up an RMA and report any active BOL already on it. */
export async function lookup(rmaNumber) {
  const data = await lookupRma(rmaNumber);
  const active = await store().get(`bol-active/${data.rma.number}`);
  return { ...data, existingBol: active?.status === 'created' ? summarize(await getRecord(active.bolNumber)) : active ? { status: active.status } : null };
}

const summarize = (r) => r && ({ status: 'created', bolNumber: r.bolNumber, proNumber: r.proNumber, quoteNumber: r.quote.quoteNumber, createdAt: r.createdAt, repName: r.repName });

function assertValid(shipment, data, opts) {
  const { errors, warnings } = validateShipment(shipment, data, opts);
  if (errors.length) throw new RepError(errors[0], 400, null, { errors, warnings });
  return warnings;
}

export async function quote({ shipment, repName }) {
  const data = await lookupRma(shipment.rmaNumber);
  const warnings = assertValid(shipment, data, { skipPickup: true }); // pickup window doesn't affect the charge
  const inputs = quoteInputs(shipment, data);
  const q = await rl.getQuote(inputs, data);
  await store().set(`quote/${q.quoteNumber}`, { ...q, rma: data.rma.number, inputsHash: hash(inputs), createdAt: new Date().toISOString() });
  await logEvent('quote', { repName, rma: data.rma.number, so: data.salesOrder.number, quoteNumber: q.quoteNumber, amount: q.totalCharge });
  return { ...q, warnings };
}

/**
 * Create the BOL exactly once per RMA.
 *  1. Same submissionId replayed (double-click / retry)  -> return the original result.
 *  2. Atomic lock `bol-active/{RMA}` (create-if-missing) -> a second BOL for the RMA is impossible.
 *  3. Quote must exist, match the RMA, be unexpired, and match the current inputs exactly.
 */
export async function createBol({ shipment, quoteNumber, submissionId, repName, checklist, replaces }) {
  const s = store();
  const rma = normalizeRma(shipment?.rmaNumber);
  if (!/^[a-zA-Z0-9-]{8,64}$/.test(submissionId || '')) throw new RepError('Refresh the page and try again.');

  const replay = await s.get(`idem/${rma}/${submissionId}`);
  if (replay) return { ...(await getRecord(replay.bolNumber)), replayed: true };

  const lock = { status: 'pending', submissionId, startedAt: Date.now(), repName };
  if (!(await s.setIfNew(`bol-active/${rma}`, lock))) {
    const cur = await s.get(`bol-active/${rma}`);
    const curRec = cur?.status === 'created' ? await getRecord(cur.bolNumber) : null;
    if (cur?.submissionId === submissionId && curRec) return { ...curRec, replayed: true };
    if (cur?.submissionId === submissionId && cur.status === 'pending')
      throw new RepError('Your BOL is still being created. Wait a few seconds; don\'t click again.', 409, null, { inProgress: true });
    if (cur?.status === 'created')
      throw new RepError(`${rma} already has a BOL (PRO ${curRec.proNumber}). Reprint it instead of creating another.`, 409, null, { existingBol: summarize(curRec) });
    if (cur?.status === 'unknown')
      throw new RepError(`We couldn't confirm whether R+L created a BOL for ${rma}. Don't retry. Ask a lead to check R+L before doing anything else.`, 409, null, { unknown: true });
    if (cur?.status === 'pending' && Date.now() - cur.startedAt < PENDING_STALE_MS)
      throw new RepError(`${cur.repName || 'Another rep'} is creating a BOL for ${rma} right now. Wait a minute, then look it up again.`, 409);
    throw new RepError(`A BOL attempt for ${rma} stalled. Ask a lead to check R+L before retrying.`, 409, { cur });
  }

  const release = () => s.delete(`bol-active/${rma}`);
  let data, q;
  try {
    const required = ['address', 'items', 'dimensions', 'freightClass', 'destination'];
    if (!required.every((k) => checklist?.[k] === true)) throw new RepError('Tick every box on the review checklist first.');
    data = await lookupRma(rma);
    assertValid(shipment, data);
    const dest = WAREHOUSES[shipment.destination];
    if (!isMock() && (!dest.confirmed || !BILL_TO.confirmed))
      throw new RepError('The warehouse or Bill To address is still a placeholder. Tell the portal admin.', 503);

    q = await s.get(`quote/${quoteNumber}`);
    if (!q || q.rma !== rma) throw new RepError('Get a quote for this return first.');
    if (Date.parse(q.expiresAt) < Date.now()) throw new RepError('This quote has expired. Click "Get Quote" again.');
    if (replaces) {
      const old = await getRecord(replaces);
      if (!old || old.rmaNumber !== rma || old.status !== 'voided') throw new RepError('The BOL you are replacing must be voided first. Start again from History.');
    }
    if (q.inputsHash !== hash(quoteInputs(shipment, data)))
      throw new RepError('Something changed since you got the quote. Click "Get Quote" again so the BOL matches the charge.');
  } catch (e) { await release(); throw e; }

  const count = ((await s.get(`bol-count/${rma}`))?.n || 0) + 1;
  const bolNumber = `RTN-${rma}-${count}`;
  let carrier;
  try {
    carrier = await rl.createBol({ shipment, data, quote: q, inputs: quoteInputs(shipment, data), shipTo: WAREHOUSES[shipment.destination], bolNumber });
  } catch (e) {
    if (e?.extra?.definite === false) {
      await s.set(`bol-active/${rma}`, { ...lock, status: 'unknown' });
      await logEvent('bol-unknown', { repName, rma, quoteNumber });
      throw new RepError(`R+L didn't answer in time, so we can't tell whether the BOL was created. Don't retry. Ask a lead to check R+L for ${rma}.`, 504, e.detail, { unknown: true });
    }
    await release();
    throw e;
  }

  await s.set(`bol-count/${rma}`, { n: count });
  const record = { ...buildRecord({ shipment, data, q, carrier, repName, bolNumber }), replaces: replaces || '' };
  if (replaces) await s.set(`bol/${replaces}`, { ...(await getRecord(replaces)), replacedBy: bolNumber });
  await s.set(`bol/${record.bolNumber}`, record);
  await s.set(`bol-active/${rma}`, { ...lock, status: 'created', bolNumber });
  await s.set(`idem/${rma}/${submissionId}`, { bolNumber });
  await logEvent('bol', { repName, rma, so: data.salesOrder.number, pro: record.proNumber, quoteNumber: q.quoteNumber, amount: q.totalCharge, bolNumber });

  // Step 2 (optional): the pickup. Step 3: save PRO / pickup # to the RMA.
  // The BOL is already saved, so a failure in either step never loses it.
  if (shipment.pickup?.schedule) await runPickup(record, shipment.pickup, repName);
  return saveToRma(bolNumber, repName);
}

export const getRecord = (bolNumber) => store().get(`bol/${bolNumber}`);
const usShort = (iso) => { const [, m, d] = iso.split('-'); return `${m}/${d}`; };

/**
 * Schedule the R+L pickup for a saved BOL, exactly once.
 * Lock `pickup/{BOL}` (create-if-missing) blocks double pickups from double clicks or retries.
 */
async function runPickup(record, pickup, repName) {
  const s = store();
  const key = `pickup/${record.bolNumber}`;
  if (!(await s.setIfNew(key, { status: 'pending', at: Date.now() }))) {
    const cur = await s.get(key);
    if (cur?.status === 'pending') throw new RepError("The pickup is still being scheduled. Wait a few seconds; don't click again.", 409, null, { inProgress: true });
    return getRecord(record.bolNumber); // already scheduled or unknown
  }
  // Acme policy: always 1–5 PM customer local time. Alternate customer dates go to R+L in the instructions.
  const alt = (record.altDates || []).map(usShort);
  const req = {
    readyTime: FREIGHT.pickupWindow.ready, closeTime: FREIGHT.pickupWindow.close,
    contactName: String(pickup.contactName).trim(), contactPhone: String(pickup.contactPhone),
    instructions: [alt.length ? `CUSTOMER ALSO AVAILABLE ${alt.join(', ')} (1-5 PM).` : '', String(pickup.instructions || '').trim()].filter(Boolean).join(' '),
  };
  let result;
  try {
    const r = await rl.schedulePickup({ ...req, proNumber: record.proNumber, pickupDate: record.pickupDate, rmaNumber: record.rmaNumber, customerName: record.shipFrom.name });
    await s.set(key, { status: 'scheduled', id: r.pickupRequestId });
    result = { status: 'scheduled', id: r.pickupRequestId, ...req };
    await logEvent('pickup', { repName, rma: record.rmaNumber, pro: record.proNumber, pickupId: r.pickupRequestId, bolNumber: record.bolNumber });
  } catch (e) {
    if (e?.extra?.definite === false) {
      await s.set(key, { status: 'unknown' });
      result = { status: 'unknown', error: `R+L didn't answer, so we can't tell whether the pickup was scheduled. Don't retry. Call R+L at 800-543-5589 with PRO ${record.proNumber} to check.`, ...req };
    } else {
      await s.delete(key); // R+L rejected it: nothing scheduled, safe to retry
      result = { status: 'failed', error: e instanceof RepError ? e.message : 'R+L could not schedule the pickup.', ...req };
    }
    await logEvent('pickup-failed', { repName, rma: record.rmaNumber, pro: record.proNumber, status: result.status, bolNumber: record.bolNumber });
  }
  const updated = { ...(await getRecord(record.bolNumber)), pickup: result };
  await s.set(`bol/${record.bolNumber}`, updated);
  return updated;
}

/** Retry ONLY the pickup step (or schedule one later) for an existing BOL. */
export async function retryPickup({ bolNumber, pickup, repName }) {
  const rec = await getRecord(bolNumber);
  if (!rec) throw new RepError("We couldn't find that BOL.", 404);
  if (rec.pickup?.status === 'scheduled') return rec;
  if (rec.pickup?.status === 'unknown') throw new RepError(rec.pickup.error, 409);
  const p = { ...(rec.pickup || {}), ...(pickup || {}), schedule: true };
  const { errors } = validatePickup(p);
  if (errors.length) throw new RepError(errors[0], 400, null, { errors });
  const after = await runPickup(rec, p, repName);
  return after.pickup?.status === 'scheduled' ? saveToRma(bolNumber, repName) : after;
}

/** Everything needed to (re)print documents later — minimal customer data. */
function buildRecord({ shipment, data, q, carrier, repName, bolNumber }) {
  const lines = data.rma.lines;
  return {
    bolNumber, status: 'active', mock: isMock(), createdAt: new Date().toISOString(), repName,
    rmaId: data.rma.id,
    writeBack: { status: 'pending' },
    proNumber: carrier.proNumber, carrierWarning: carrier.warning || '',
    pickup: { status: 'not-requested' },
    quote: { quoteNumber: q.quoteNumber, totalCharge: q.totalCharge, expiresAt: q.expiresAt, serviceDays: q.serviceDays || null },
    rmaNumber: data.rma.number, salesOrder: data.salesOrder,
    shipFrom: data.customer,
    shipTo: WAREHOUSES[shipment.destination],
    billTo: BILL_TO, csContact: CS_CONTACT,
    pickupDate: shipment.pickupDate,
    altDates: (shipment.altDates || []).filter(Boolean),
    accessorials: quoteInputs(shipment, data).accessorials,
    pallets: shipment.pallets.map((p) => {
      const weightLb = palletWeight(p, lines);
      return {
        type: p.type, length: Number(p.length), width: Number(p.width), height: Number(p.height), weightLb,
        densityPcf: densityPcf(weightLb, p.length, p.width, p.height), freightClass: String(p.freightClass), nmfc: p.nmfc,
        items: p.items.filter((i) => i.qty > 0).map((i) => {
          const l = lines.find((x) => x.lineId === i.lineId);
          return { sku: l.sku, description: l.description, qty: i.qty };
        }),
      };
    }),
    totals: totals(shipment, lines),
    // What the rep entered, so "Duplicate & edit" can start from it instead of from scratch.
    input: { destination: shipment.destination, pickupDate: shipment.pickupDate, altDates: shipment.altDates || [], accessorials: shipment.accessorials, pallets: shipment.pallets, pickup: shipment.pickup || null },
    purgeAfter: new Date(Date.now() + RETENTION_DAYS * 86400000).toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------
// Phase 3: NetSuite write-back, void / Duplicate & edit, history

/** Save PRO (and pickup #, if any) to the RMA. Never throws: the result is recorded on the BOL. */
async function saveToRma(bolNumber, repName) {
  const s = store();
  const rec = await getRecord(bolNumber);
  if (!rec || rec.status === 'voided') return rec;
  const pickupId = rec.pickup?.status === 'scheduled' ? rec.pickup.id : '';
  let writeBack;
  try {
    await writeRmaFields({ rmaId: rec.rmaId, rmaNumber: rec.rmaNumber, proNumber: rec.proNumber, pickupId });
    writeBack = { status: 'saved', pro: rec.proNumber, pickupId, at: new Date().toISOString() };
    await logEvent('writeback', { repName, rma: rec.rmaNumber, pro: rec.proNumber, pickupId, bolNumber });
  } catch (e) {
    writeBack = { status: 'failed', error: e instanceof RepError ? e.message : 'NetSuite did not accept the update.', at: new Date().toISOString() };
    await logEvent('writeback-failed', { repName, rma: rec.rmaNumber, pro: rec.proNumber, bolNumber });
  }
  const updated = { ...(await getRecord(bolNumber)), writeBack };
  await s.set(`bol/${bolNumber}`, updated);
  return updated;
}

/** Retry ONLY the NetSuite write-back. */
export async function retryWriteBack({ bolNumber, repName }) {
  const rec = await getRecord(bolNumber);
  if (!rec) throw new RepError("We couldn't find that BOL.", 404);
  if (rec.status === 'voided') throw new RepError('This BOL was voided, so nothing is saved to the RMA for it.');
  return saveToRma(bolNumber, repName);
}

/**
 * Void a BOL so a corrected replacement can be made ("Duplicate & edit").
 * R+L has no API to void a BOL, so the rep confirms they asked R+L to void the PRO.
 * A scheduled pickup IS cancelled through R+L's API; if that fails we stop and void nothing.
 */
export async function voidBol({ bolNumber, repName, reason, confirmedRlVoid }) {
  const s = store();
  const rec = await getRecord(bolNumber);
  if (!rec) throw new RepError("We couldn't find that BOL.", 404);
  if (rec.status === 'voided') return { record: rec };
  if (confirmedRlVoid !== true) throw new RepError(`First ask R+L to void PRO ${rec.proNumber} (800-543-5589), then tick the box.`);
  const why = String(reason || '').trim().slice(0, 100);
  if (!why) throw new RepError('Say briefly why this BOL is being replaced.');

  let pickup = rec.pickup;
  if (pickup?.status === 'scheduled') {
    try {
      await rl.cancelPickup({ pickupRequestId: pickup.id, reason: why });
      pickup = { ...pickup, status: 'cancelled' };
      await logEvent('pickup-cancel', { repName, rma: rec.rmaNumber, pro: rec.proNumber, pickupId: rec.pickup.id, bolNumber });
    } catch (e) {
      throw new RepError(`We couldn't cancel R+L pickup #${pickup.id}, so nothing was voided. Call R+L at 800-543-5589 to cancel it, then try again.`, 502, e.detail);
    }
  } else if (pickup?.status === 'unknown') {
    throw new RepError(`The pickup for PRO ${rec.proNumber} is in an unknown state. Call R+L at 800-543-5589 to check and cancel it before voiding.`, 409);
  }

  const voided = { ...rec, status: 'voided', pickup, voidedAt: new Date().toISOString(), voidedBy: repName, voidReason: why };
  await s.set(`bol/${bolNumber}`, voided);
  const active = await s.get(`bol-active/${rec.rmaNumber}`);
  if (active?.bolNumber === bolNumber) await s.delete(`bol-active/${rec.rmaNumber}`); // RMA can get its replacement BOL
  await s.delete(`pickup/${bolNumber}`);
  await logEvent('void', { repName, rma: rec.rmaNumber, so: rec.salesOrder.number, pro: rec.proNumber, bolNumber, reason: why });
  return { record: voided };
}

/** Search past returns by RMA, PRO, BOL #, sales order, or customer name. Newest first. */
export async function history({ q = '', limit = 50 } = {}) {
  const s = store();
  const needle = String(q).trim().toLowerCase();
  const out = [];
  for (const key of await s.list('bol/')) {
    const r = await s.get(key);
    if (!r) continue;
    const hay = [r.rmaNumber, r.proNumber, r.bolNumber, r.salesOrder?.number, r.salesOrder?.po, r.shipFrom?.name].join(' ').toLowerCase();
    if (needle && !hay.includes(needle)) continue;
    out.push({
      bolNumber: r.bolNumber, rmaNumber: r.rmaNumber, salesOrder: r.salesOrder?.number, customer: r.shipFrom?.name,
      city: `${r.shipFrom?.city}, ${r.shipFrom?.state}`, destination: r.shipTo?.key, proNumber: r.proNumber,
      amount: r.quote?.totalCharge, createdAt: r.createdAt, repName: r.repName, status: r.status || 'active',
      pickup: r.pickup, writeBack: r.writeBack, replaces: r.replaces || '', replacedBy: r.replacedBy || '',
      voidReason: r.voidReason || '', pallets: r.pallets?.length || 0, mock: r.mock,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}
