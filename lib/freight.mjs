// Pure freight math + validation. Shared by the browser and the server so both
// enforce exactly the same rules (the server re-checks everything).
import { FREIGHT, WAREHOUSES } from '../config/app-config.mjs';
import { suggestPallets } from './packaging.mjs';

export const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const cubicFeet = (l, w, h) => (l * w * h) / 1728;

export function densityPcf(weightLb, l, w, h) {
  const cf = cubicFeet(l, w, h);
  return cf > 0 ? round(weightLb / cf, 2) : 0;
}

/** Item weight (lb) of everything assigned to one pallet. */
export function itemsWeight(pallet, rmaLines) {
  return pallet.items.reduce((sum, a) => {
    const line = rmaLines.find((l) => l.lineId === a.lineId);
    return sum + (line ? line.unitWeightLb * a.qty : 0);
  }, 0);
}

/** Pallet weight = sum of the returning items' NetSuite weights. Reps are never asked for it. */
export const palletWeight = (pallet, rmaLines) => round(itemsWeight(pallet, rmaLines), 1);

/** Suggested NMFC 015520 sub + class for a density. The rep must still confirm it. */
export function suggestClass(density) {
  if (!(density > 0) || !FREIGHT.densityTable) return null;
  const row = FREIGHT.densityTable.find((r) => density >= r.min && density < r.max);
  return row && { nmfc: `${FREIGHT.nmfcBase}-${row.sub}`, freightClass: row.freightClass, range: row };
}

export function totals(shipment, rmaLines) {
  const weights = shipment.pallets.map((p) => palletWeight(p, rmaLines));
  return {
    pallets: shipment.pallets.length,
    weightLb: round(weights.reduce((a, b) => a + b, 0), 1),
    qty: shipment.pallets.reduce((s, p) => s + p.items.reduce((a, i) => a + i.qty, 0), 0),
  };
}

// ---- dates (pickup must be a business day, not in the past, within R+L's quote window)
export function todayIso(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
const parseIso = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
export const isWeekend = (iso) => [0, 6].includes(parseIso(iso).getUTCDay());
export function daysBetween(fromIso, toIso) {
  return Math.round((parseIso(toIso) - parseIso(fromIso)) / 86400000);
}
export function nextBusinessDay(iso) {
  let d = parseIso(iso);
  do d = new Date(d.getTime() + 86400000);
  while ([0, 6].includes(d.getUTCDay()));
  return d.toISOString().slice(0, 10);
}
export function addBusinessDays(iso, n) {
  let d = iso;
  for (let i = 0; i < n; i++) d = nextBusinessDay(d);
  return d;
}
/** R+L needs ~2 business days' notice: no same-day or next-day pickups. */
export const earliestPickupDate = (today = todayIso()) => addBusinessDays(today, FREIGHT.minPickupBusinessDays);

/** Customer's available dates: first choice + up to 2 alternates, de-duplicated, empty removed. */
export const pickupDates = (shipment) => [shipment.pickupDate, ...(shipment.altDates || [])].filter(Boolean);

function checkPickupDate(d, label, today) {
  const earliest = earliestPickupDate(today);
  if (isWeekend(d)) return `${label} is a weekend. R+L only picks up Monday–Friday.`;
  if (d < earliest) return `${label} is too soon. R+L needs 2 business days' notice, so the earliest pickup is ${earliest}.`;
  if (daysBetween(today, d) > FREIGHT.maxQuoteDaysAhead) return `${label} is more than ${FREIGHT.maxQuoteDaysAhead} days out. R+L can't quote that far ahead.`;
  return '';
}

/** Accessorials requested, as R+L AdditionalServices codes (Rate Quote + BOL), fixed order. */
export function accessorialList(shipment, customer) {
  const a = [];
  if (shipment.accessorials.residential ?? customer?.residential) a.push('ResidentialPickup');
  if (shipment.accessorials.liftgate) a.push('OriginLiftgate');
  if (shipment.accessorials.limitedAccess) a.push('LimitedAccessPickup');
  if (shipment.accessorials.insidePickup) a.push('InsidePickup');
  return a;
}
export const ACCESSORIAL_LABELS = {
  ResidentialPickup: 'Residential Pickup',
  OriginLiftgate: 'Lift Gate',
  LimitedAccessPickup: 'Limited Access Pickup',
  InsidePickup: 'Inside Pickup',
};

/** Everything that, if changed, requires a new quote. Order-stable. */
export function quoteInputs(shipment, lookup) {
  const lines = lookup.rma.lines;
  return {
    rma: lookup.rma.number,
    destination: shipment.destination,
    pickupDate: shipment.pickupDate,
    origin: { zip: lookup.customer.zip },
    accessorials: accessorialList(shipment, lookup.customer),
    pallets: shipment.pallets.map((p) => ({
      type: p.type,
      dims: [Number(p.length), Number(p.width), Number(p.height)],
      weightLb: palletWeight(p, lines),
      freightClass: String(p.freightClass),
      nmfc: p.nmfc,
      items: [...p.items].filter((i) => i.qty > 0).sort((a, b) => a.lineId.localeCompare(b.lineId)).map((i) => [i.lineId, i.qty]),
    })),
  };
}

/**
 * Validate a shipment against its RMA. Errors block; warnings say "Double-check this".
 * Messages are plain English for reps.
 */
export function validateShipment(shipment, lookup, { now = new Date(), skipPickup = false } = {}) {
  const errors = [];
  const warnings = [];
  const lines = lookup.rma.lines;

  if (!WAREHOUSES[shipment.destination]) errors.push('Choose where the return is going (California or Pennsylvania).');
  else if (!WAREHOUSES[shipment.destination].confirmed)
    warnings.push(`The ${WAREHOUSES[shipment.destination].label} warehouse address is still a placeholder.`);

  const today = todayIso(now);
  if (!shipment.pickupDate) errors.push("Enter the customer's first-choice pickup date.");
  else {
    const dates = pickupDates(shipment);
    if (dates.length > 3) errors.push('Enter at most 3 pickup dates.');
    if (new Set(dates).size !== dates.length) errors.push('Each pickup date should be a different day.');
    dates.forEach((d, i) => {
      const msg = checkPickupDate(d, i === 0 ? 'The first-choice date' : `Alternate date ${i}`, today);
      if (msg) errors.push(msg);
    });
  }

  if (!shipment.pallets.length) errors.push('Add at least one pallet or crate.');
  if (shipment.pallets.length > FREIGHT.maxPallets) errors.push(`A return can have at most ${FREIGHT.maxPallets} pallets.`);

  shipment.pallets.forEach((p, i) => {
    const n = `Pallet ${i + 1}`;
    const [l, w, h] = [p.length, p.width, p.height].map(Number);
    if (!(l > 0 && w > 0 && h > 0)) errors.push(`${n} needs a length, width, and height in inches.`);
    else if (l > 636 || w > 102 || h > 110) warnings.push(`${n}: those dimensions look too large for a trailer. Double-check this.`);
    const wt = palletWeight(p, lines);
    if (!(wt > 0)) errors.push(`${n} needs a weight.`);
    if (!FREIGHT.validClasses.includes(String(p.freightClass))) errors.push(`R+L needs a freight class for ${n}. Click "Use this class" or enter it manually.`);
    else if (!/^\d{6}(-\d{2})?$/.test(p.nmfc || '')) errors.push(`${n} needs an NMFC number like 015520-07.`);
    if (!p.items.some((x) => x.qty > 0)) errors.push(`${n} has no items. Assign items or remove the pallet.`);
    if (l > 0 && w > 0 && h > 0 && wt > 0) {
      const d = densityPcf(wt, l, w, h);
      const [wMin, wMax] = FREIGHT.ranges.palletWeightLb;
      const [dMin, dMax] = FREIGHT.ranges.densityPcf;
      if (wt < wMin || wt > wMax) warnings.push(`${n} weighs ${wt} lb, which is unusual. Double-check this.`);
      if (d < dMin || d > dMax) warnings.push(`${n} density is ${d} lb/ft³, which is unusual. Double-check this.`);
    }
    p.items.forEach((a) => {
      if (!Number.isInteger(a.qty) || a.qty < 0) errors.push(`${n}: quantities must be whole numbers.`);
      if (!lines.find((x) => x.lineId === a.lineId)) errors.push(`${n} has an item that is not on the RMA.`);
    });
  });

  // Every RMA unit assigned exactly once — never more than the RMA allows.
  for (const line of lines) {
    const assigned = shipment.pallets.reduce(
      (s, p) => s + p.items.filter((a) => a.lineId === line.lineId).reduce((x, a) => x + a.qty, 0), 0);
    if (assigned > line.qty) errors.push(`${line.sku}: ${assigned} assigned but the RMA only has ${line.qty}.`);
    else if (assigned < line.qty) errors.push(`${line.sku}: assign all ${line.qty} to a pallet (${assigned} assigned so far).`);
  }

  const pv = skipPickup ? { errors: [], warnings: [] } : validatePickup(shipment.pickup);
  errors.push(...pv.errors); warnings.push(...pv.warnings);

  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

/**
 * Pickup contact (only when the rep ticks "Schedule R+L pickup").
 * The window is fixed by Acme policy (FREIGHT.pickupWindow, 1–5 PM) so it is not validated here.
 */
export function validatePickup(pu) {
  const errors = [], warnings = [];
  if (pu?.schedule) {
    if (!String(pu.contactName || '').trim()) errors.push('Add the customer contact name for the R+L pickup.');
    if (String(pu.contactPhone || '').replace(/\D/g, '').length < 10) errors.push('Add a 10-digit customer phone number for the R+L pickup.');
  }
  return { errors, warnings };
}

/** Fill class + NMFC from Acme's density table unless the rep edited them by hand. */
export function autoClass(pallet, rmaLines) {
  if (pallet.classManual) return pallet;
  const wt = palletWeight(pallet, rmaLines);
  const d = [pallet.length, pallet.width, pallet.height].every((x) => Number(x) > 0) && wt > 0
    ? densityPcf(wt, Number(pallet.length), Number(pallet.width), Number(pallet.height)) : 0;
  const s = suggestClass(d);
  return { ...pallet, freightClass: s?.freightClass || '', nmfc: s?.nmfc || '' };
}

/**
 * Starting pallets for a return. NetSuite doesn't record container sizes, so the portal makes
 * Acme's usual guess from the RMA items (lib/packaging.mjs). The rep can change it, or drop in the
 * original BOL / packing list for exact sizes (lib/docparse.mjs).
 */
export function prefillPallets(lookup) {
  return suggestPallets(lookup.rma.lines).map((p) => autoClass(p, lookup.rma.lines));
}
