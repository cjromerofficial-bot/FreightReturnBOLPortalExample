// R+L Carriers adapter. MOCK MODE returns realistic fake responses; LIVE calls R+L's REST API.
// Field names come from R+L's published Swagger (https://api.rlc.com/swagger/docs/v1) and
// docs at technology.rlcarriers.com. Auth: header `apiKey`.
//   POST /RateQuote    -> RateQuote.ServiceLevels[].QuoteNumber / NetCharge, RateQuote.Charges[]
//   POST /BillOfLading -> ProNumber (+ PickupRequestNumber if a pickup is included)
// R+L documents no endpoint to void a BOL (pickups can be cancelled with DELETE /PickupRequest).
import crypto from 'node:crypto';
import { rlLive, nsLive, rlSandbox, RepError } from './http.mjs';
import { FREIGHT, BILL_TO, WAREHOUSES } from '../config/app-config.mjs';

const BASE = () => (process.env.RL_BASE_URL || 'https://api.rlc.com').replace(/\/$/, '');
const quoteExpiry = () => new Date(Date.now() + FREIGHT.quoteValidHours * 3600000).toISOString();

/** @returns {{quoteNumber:string,totalCharge:number,currency:'USD',expiresAt:string,charges:{label:string,amount:number}[]}} */
export async function getQuote(inputs, data) {
  return rlLive() ? liveQuote(inputs, data) : mockQuote(inputs);
}

/**
 * @returns {{proNumber:string, carrierBolId:string}}
 * Throws RepError with extra.definite=true when R+L clearly rejected it (safe to retry),
 * or definite=false when we can't tell whether R+L created it (NOT safe to retry).
 */
/**
 * Schedule an R+L pickup for an existing BOL (POST /PickupRequest/FromBOL).
 * @returns {{pickupRequestId:string}}
 */
export async function schedulePickup(p) {
  return rlLive() ? liveSchedulePickup(p) : mockSchedulePickup(p);
}

export async function createBol(payload) {
  if (!rlLive()) return mockCreateBol(payload);
  // Never create a real R+L BOL for a fake (mock NetSuite) customer.
  if (!nsLive() && !rlSandbox())
    throw new RepError('Real BOLs can only be created once NetSuite is connected. Quotes are live; BOLs stay mock for now.', 503, 'live RL BOL blocked while NetSuite is mock', { definite: true });
  return liveCreateBol(payload);
}

// ---------------- MOCK ----------------
const ACC_PRICE = { ResidentialPickup: 125, OriginLiftgate: 95, LimitedAccessPickup: 85, InsidePickup: 110 };
const digits = (n) => Array.from(crypto.randomBytes(n), (b) => b % 10).join('');

function mockQuote(inputs) {
  const weight = inputs.pallets.reduce((s, p) => s + p.weightLb, 0);
  const lane = inputs.destination === 'PA' ? 1.4 : 1.0;
  const linehaul = Math.round((95 + weight * 0.21) * lane * 100) / 100;
  const charges = [{ label: 'Linehaul (MOCK)', amount: linehaul }];
  for (const a of inputs.accessorials) charges.push({ label: `${a} (MOCK)`, amount: ACC_PRICE[a] });
  const totalCharge = Math.round(charges.reduce((s, c) => s + c.amount, 0) * 100) / 100;
  return { quoteNumber: `MQ${digits(8)}`, totalCharge, currency: 'USD', expiresAt: quoteExpiry(), serviceDays: inputs.destination === 'PA' ? 4 : 2, charges };
}

async function mockCreateBol() {
  const fail = process.env.MOCK_RL_BOL_FAIL; // test hook: 'reject' | 'timeout'
  if (fail === 'reject') throw new RepError('R+L rejected the BOL: the consignee ZIP is not serviceable (MOCK). Nothing was created, so it\'s safe to fix and try again.', 502, 'mock reject', { definite: true });
  if (fail === 'timeout') throw new RepError('timeout', 504, 'mock timeout', { definite: false });
  if (process.env.MOCK_RL_DELAY_MS) await new Promise((r) => setTimeout(r, Number(process.env.MOCK_RL_DELAY_MS)));
  return { proNumber: digits(9), carrierBolId: '' };
}

async function mockSchedulePickup() {
  const fail = process.env.MOCK_RL_PICKUP_FAIL; // test hook: 'reject' | 'timeout'
  if (fail === 'reject') throw new RepError('R+L could not schedule the pickup: no driver available for that window (MOCK). The BOL is fine.', 422, 'mock pickup reject', { definite: true });
  if (fail === 'timeout') throw new RepError('timeout', 504, 'mock pickup timeout', { definite: false });
  return { pickupRequestId: String(4000000 + Number(digits(6))) };
}

// ---------------- LIVE ----------------
const money = (s) => Number(String(s ?? '').replace(/[^0-9.-]/g, '')) || 0;
const usDate = (iso) => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };
const nmfcParts = (nmfc) => { const [item, sub] = String(nmfc).split('-'); return { NMFCItemNumber: item, NMFCSubNumber: sub || '' }; };
const rlClass = (c) => (String(c).includes('.') ? String(c) : `${c}.0`); // R+L lists classes as 50.0 … 92.5 … 500.0

async function call(method, path, body, { timeoutMs = 25000 } = {}) {
  if (!process.env.RL_API_KEY) throw new RepError('The portal is not connected to R+L yet. Tell the portal admin.', 503, 'missing RL_API_KEY', { definite: true });
  let res;
  try {
    res = await fetch(`${BASE()}${path}`, {
      method,
      headers: { apiKey: process.env.RL_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    // Network error or timeout: R+L may or may not have processed it.
    throw new RepError('We couldn\'t reach R+L.', 504, { path, error: String(e) }, { definite: false });
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  const errs = (json?.Errors || []).map((e) => e.ErrorMessage || e.ExceptionMessage).filter(Boolean);
  if (!res.ok || errs.length) {
    const definite = res.status >= 400 && res.status < 500; // validation/auth errors: nothing was created
    const msg = errs.length ? `R+L says: ${errs.join(' ')}` : `R+L returned an error (${res.status}).`;
    throw new RepError(definite ? `${msg} Nothing was created, so fix it and try again.` : msg, definite ? 422 : 502, { path, status: res.status, json }, { definite });
  }
  return json;
}

function rlItems(inputs) {
  return inputs.pallets.map((p) => ({
    Class: rlClass(p.freightClass),
    Weight: Math.ceil(p.weightLb),
    Length: p.dims[0], Width: p.dims[1], Height: p.dims[2],
    ...nmfcParts(p.nmfc),
  }));
}

async function liveQuote(inputs, data) {
  const c = data.customer;
  const w = WAREHOUSES[inputs.destination];
  const r = await call('POST', '/RateQuote', {
    RateQuote: {
      PickupDate: usDate(inputs.pickupDate),
      Origin: { City: c.city, StateOrProvince: c.state, ZipOrPostalCode: c.zip, CountryCode: 'USA' },
      Destination: { City: w.city, StateOrProvince: w.state, ZipOrPostalCode: w.zip, CountryCode: 'USA' },
      Items: rlItems(inputs),
      AdditionalServices: inputs.accessorials,
    },
  });
  const q = r.RateQuote || {};
  const levels = q.ServiceLevels || [];
  const std = levels.find((l) => /standard/i.test(`${l.Name} ${l.Code}`)) || levels[0];
  if (!std?.QuoteNumber) throw new RepError('R+L didn\'t return a quote for this shipment. Check the ZIP codes and try again.', 502, { json: r });
  return {
    quoteNumber: std.QuoteNumber,
    totalCharge: money(std.NetCharge || std.Charge),
    currency: 'USD',
    expiresAt: quoteExpiry(),
    serviceDays: std.ServiceDays,
    charges: (q.Charges || []).filter((x) => x.Amount).map((x) => ({ label: x.Title || x.Type, amount: money(x.Amount) })),
    messages: [...(q.CategorizedMessages?.RatesMessages || []), ...(q.CategorizedMessages?.GeneralMessages || [])],
  };
}

function party(a) {
  return {
    CompanyName: a.name.slice(0, 40), AddressLine1: a.address1, AddressLine2: a.address2 || undefined,
    City: a.city, StateOrProvince: a.state, ZipOrPostalCode: a.zip, CountryCode: 'USA',
    PhoneNumber: String(a.phone || '').replace(/\D/g, '').slice(-10) || undefined, EmailAddress: a.email || undefined,
  };
}

async function liveCreateBol(args) {
  try {
    return await sendBol(args, args.inputs.accessorials, '');
  } catch (e) {
    // R+L's sandbox rejects ResidentialPickup on BOLs even though the docs allow it. R+L rejected the
    // whole request (nothing created), so retry once with it written into the instructions instead,
    // and tell the rep. The quote — and so the charge — still includes the residential fee.
    const bad = JSON.stringify(e?.detail?.json?.Errors || '');
    if (e?.extra?.definite && /invalid: .*ResidentialPickup/.test(bad)) {
      const r = await sendBol(args, args.inputs.accessorials.filter((a) => a !== 'ResidentialPickup'), 'RESIDENTIAL PICKUP. ');
      return { ...r, warning: 'R+L would not accept "Residential Pickup" as a BOL code, so it was added to the BOL special instructions instead. The quote already includes the residential fee.' };
    }
    throw e;
  }
}

async function sendBol({ shipment, data, quote, inputs, shipTo, bolNumber }, accessorials, extraNote) {
  const r = await call('POST', '/BillOfLading', {
    BillOfLading: {
      BOLDate: usDate(shipment.pickupDate),
      Shipper: party(data.customer),
      Consignee: { ...party(shipTo), Attention: 'RETURNS RECEIVING' },
      BillTo: { CompanyName: `${BILL_TO.name} ${BILL_TO.company}`.slice(0, 40), AddressLine1: BILL_TO.address1, City: BILL_TO.city, StateOrProvince: BILL_TO.state, ZipOrPostalCode: BILL_TO.zip, CountryCode: 'USA' },
      AdditionalServices: accessorials,
      HandlingUnits: inputs.pallets.map((p) => ({
        UnitType: p.type === 'Crate' ? 'CRT' : 'PLT',
        Dimensions: [{ Count: 1, Length: String(p.dims[0]), Width: String(p.dims[1]), Height: String(p.dims[2]) }],
        Items: [{ Pieces: 1, PackageType: p.type === 'Crate' ? 'CRT' : 'PLT', Description: FREIGHT.commodity, Class: rlClass(p.freightClass), Weight: Math.ceil(p.weightLb), ...nmfcParts(p.nmfc) }],
      })),
      ReferenceNumbers: { ShipperNumber: bolNumber, RateQuoteNumber: quote.quoteNumber, PONumber: data.rma.number },
      SpecialInstructions: `${extraNote}CUSTOMER RETURN ${data.rma.number} / ${data.salesOrder.number}. CALL CUSTOMER BEFORE PICKUP: ${data.customer.phone}`.slice(0, 250),
      FreightChargePaymentMethod: 'Prepaid',
      ServiceLevel: 'Standard',
    },
  }, { timeoutMs: 40000 });
  if (!r?.ProNumber) throw new RepError('R+L didn\'t send back a PRO number.', 502, { json: r }, { definite: false });
  return { proNumber: r.ProNumber, carrierBolId: '', pickupRequestNumber: r.PickupRequestNumber || '' };
}


/** '13:30' -> '01:30 PM' (R+L format hh:mm tt, customer's local time). */
export function rlTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${String(((h + 11) % 12) + 1).padStart(2, '0')}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

async function liveSchedulePickup({ proNumber, pickupDate, readyTime, closeTime, contactName, contactPhone, instructions, rmaNumber, customerName }) {
  const r = await call('POST', '/PickupRequest/FromBOL', {
    ProNumber: proNumber,
    PickupInformation: {
      PickupDate: usDate(pickupDate),
      ReadyTime: rlTime(readyTime),
      CloseTime: rlTime(closeTime),
      AdditionalInstructions: (instructions || '').slice(0, 250) || undefined,
    },
    Contact: { Name: contactName.slice(0, 50), CompanyName: customerName?.slice(0, 40), PhoneNumber: contactPhone.replace(/\D/g, '').slice(-10) },
    SendEmailConfirmation: false,
    ShipperReferenceNumber: rmaNumber,
  });
  if (!r?.PickupRequestId) throw new RepError('R+L didn\'t send back a pickup confirmation number.', 502, { json: r }, { definite: false });
  return { pickupRequestId: String(r.PickupRequestId) };
}

/** Cancel an R+L pickup (DELETE /PickupRequest). Throws RepError on failure. */
export async function cancelPickup({ pickupRequestId, reason }) {
  if (!rlLive()) {
    if (process.env.MOCK_RL_CANCEL_FAIL) throw new RepError('R+L could not cancel the pickup (MOCK).', 422, 'mock cancel fail', { definite: true });
    return { cancelled: true };
  }
  await call('DELETE', '/PickupRequest', { PickupRequestId: Number(pickupRequestId), Reason: String(reason).slice(0, 100) });
  return { cancelled: true };
}
