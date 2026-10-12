// Smart pallet guess from the RMA items — Acme's rules of thumb, not hard rules.
// The rep sees each guess with its reason and can change it. Weights always come from NetSuite items.
//
//   • Titan 2.0 Base and Weight Stacks (incl. wall mount)  -> its own 48x40x60 crate (per unit)
//   • Dumbbell sets                                         -> 48x40x60 crate (dumbbell racks ride with them)
//   • Treadmills                                            -> 73x46x33 pallet (per unit)
//   • Everything else that ships LTL                        -> one 96x40x20 pallet
// (Altitude and flooring intentionally not handled yet.)

const CRATE = { type: 'Crate', length: 48, width: 40, height: 60 };
const PALLET_96 = { type: 'Pallet', length: 96, width: 40, height: 20 };
const TREADMILL = { type: 'Pallet', length: 73, width: 46, height: 33 };

const text = (l) => `${l.sku} ${l.description}`;
export const RULES = {
  titan: (l) => /titan\s*2(\.0)?\s+base\s+and\s+weight\s+stacks?/i.test(text(l)) || /^PRA-FT-DUAL-5003/i.test(l.sku),
  dumbbellSet: (l) => /dumbbell\s+set|^DBS-/i.test(text(l)),
  dumbbellRack: (l) => /(dumbbell|db)\s+storage\s+rack|^WS-/i.test(text(l)),
  treadmill: (l) => /treadmill/i.test(text(l)),
};

/**
 * @param {{lineId:string, sku:string, description:string, qty:number}[]} lines
 * @returns pallets in the portal's shipment shape, each with a plain-English `reason`
 */
export function suggestPallets(lines) {
  const pallets = [];
  const left = new Map(lines.map((l) => [l.lineId, l.qty]));
  const take = (l, qty) => { left.set(l.lineId, left.get(l.lineId) - qty); return { lineId: l.lineId, qty }; };
  const add = (dims, items, reason) => pallets.push({ id: `p${pallets.length + 1}`, ...dims, items, reason, freightClass: '', nmfc: '', classManual: false });

  for (const l of lines.filter(RULES.titan)) for (let i = 0; i < l.qty; i++) add(CRATE, [take(l, 1)], 'Titan 2.0 base & weight stacks always ship in their own crate');
  for (const l of lines.filter(RULES.treadmill)) for (let i = 0; i < l.qty; i++) add(TREADMILL, [take(l, 1)], 'Treadmills ship on a 73" pallet');

  const sets = lines.filter(RULES.dumbbellSet);
  if (sets.length) {
    const items = sets.map((l) => take(l, l.qty));
    for (const r of lines.filter((l) => RULES.dumbbellRack(l) && left.get(l.lineId) > 0)) items.push(take(r, left.get(r.lineId)));
    add(CRATE, items, 'Dumbbell sets ship in a crate (with their rack)');
  }

  const rest = lines.filter((l) => left.get(l.lineId) > 0);
  if (rest.length) add(PALLET_96, rest.map((l) => take(l, left.get(l.lineId))), pallets.length
    ? 'Everything else ships on a 96" pallet'
    : 'LTL orders almost always ship on a 96" pallet');
  return pallets;
}
