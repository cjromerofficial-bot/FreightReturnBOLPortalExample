// NetSuite access. MOCK MODE returns fake records; LIVE uses SuiteTalk REST + SuiteQL with
// token-based auth (OAuth 1.0a, HMAC-SHA256).
//
// LIVE STATUS: written against standard NetSuite SuiteQL tables but NOT yet run against Acme's
// account. Field mappings marked "CONFIRM" need the NetSuite admin's sign-off. The PaceJet
// pallet/package fields are unknown (open question 13), so live lookups return no prefilled
// pallets and the rep enters dimensions until that mapping is confirmed.
import crypto from 'node:crypto';
import { nsLive, RepError } from './http.mjs';
import { MOCK_RMAS } from './mock/netsuite-data.mjs';

export const normalizeRma = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, '');

export async function lookupRma(rmaInput) {
  const rmaNumber = normalizeRma(rmaInput);
  if (!/^[A-Z0-9-]{3,30}$/.test(rmaNumber))
    throw new RepError('That doesn\'t look like an RMA number. Copy it from the RMA in NetSuite (for example RMA100001).');
  const found = nsLive() ? await liveLookup(rmaNumber) : structuredClone(MOCK_RMAS[rmaNumber] || null);
  if (!found)
    throw new RepError(`We couldn't find ${rmaNumber} in NetSuite. Check the number on the RMA. If the RMA hasn't been created yet, create it in NetSuite first.`, 404);
  if (!found.rma.lines.length)
    throw new RepError(`${rmaNumber} has no items on it. Add the returning items to the RMA in NetSuite, then try again.`, 422);
  return found;
}

// ---------------- LIVE ----------------
function oauthHeader(method, url) {
  const { NS_ACCOUNT_ID, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET } = process.env;
  if (![NS_ACCOUNT_ID, NS_CONSUMER_KEY, NS_CONSUMER_SECRET, NS_TOKEN_ID, NS_TOKEN_SECRET].every(Boolean))
    throw new RepError('The portal is not connected to NetSuite yet. Tell the portal admin.', 503, 'missing NS_* env vars');
  const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  const u = new URL(url);
  const params = {
    oauth_consumer_key: NS_CONSUMER_KEY, oauth_token: NS_TOKEN_ID, oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_timestamp: String(Math.floor(Date.now() / 1000)), oauth_signature_method: 'HMAC-SHA256', oauth_version: '1.0',
  };
  const all = [...Object.entries(params), ...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort();
  const base = [method, enc(`${u.origin}${u.pathname}`), enc(all.map(([k, v]) => `${k}=${v}`).join('&'))].join('&');
  const sig = crypto.createHmac('sha256', `${enc(NS_CONSUMER_SECRET)}&${enc(NS_TOKEN_SECRET)}`).update(base).digest('base64');
  const realm = NS_ACCOUNT_ID.toUpperCase().replace('-', '_');
  return 'OAuth ' + [`realm="${realm}"`, ...Object.entries({ ...params, oauth_signature: sig }).map(([k, v]) => `${k}="${enc(v)}"`)].join(', ');
}

async function suiteql(query) {
  const host = process.env.NS_ACCOUNT_ID.toLowerCase().replace('_', '-');
  const url = `https://${host}.suitetalk.api.netsuite.com/services/rest/query/v1/suiteql?limit=200`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: oauthHeader('POST', url), Prefer: 'transient', 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query }),
  });
  if (!res.ok) throw new RepError('NetSuite didn\'t respond correctly. Try again in a minute.', 502, { status: res.status, body: await res.text() });
  return (await res.json()).items || [];
}

const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const LB_PER = { 1: 1, 2: 1 / 16, 3: 2.20462, 4: 0.00220462 }; // CONFIRM: item.weightunit codes lb/oz/kg/g

async function liveLookup(rmaNumber) {
  const [rma] = await suiteql(
    `SELECT t.id, t.tranid, t.memo, t.createdfrom FROM transaction t WHERE t.type = 'RtnAuth' AND t.tranid = ${lit(rmaNumber)}`);
  if (!rma) return null;
  const lines = await suiteql(
    `SELECT tl.id AS lineid, i.itemid, i.displayname, ABS(tl.quantity) AS qty, i.weight, i.weightunit
       FROM transactionline tl JOIN item i ON i.id = tl.item
      WHERE tl.transaction = ${Number(rma.id)} AND tl.mainline = 'F' AND tl.taxline = 'F' AND i.itemtype IN ('InvtPart','Kit','Assembly','NonInvtPart')`);
  // CONFIRM: residential flag source; shipping address join on the sales order.
  const [so] = await suiteql(
    `SELECT t.tranid, t.otherrefnum, t.trandate, t.email, a.addressee, a.attention, a.addr1, a.addr2, a.city, a.state, a.zip,
            a.addrphone, a.isresidential
       FROM transaction t LEFT JOIN transactionshippingaddress a ON a.nkey = t.shippingaddress
      WHERE t.id = ${Number(rma.createdfrom)}`);
  if (!so) throw new RepError(`${rmaNumber} isn't linked to a sales order in NetSuite. Fix the RMA, then try again.`, 422);
  return {
    rma: {
      number: rma.tranid, id: rma.id, memo: rma.memo || '',
      lines: lines.map((l) => ({
        lineId: String(l.lineid), sku: l.itemid, description: l.displayname || l.itemid, qty: Number(l.qty),
        unitWeightLb: Number(l.weight || 0) * (LB_PER[l.weightunit] || 1),
      })),
    },
    salesOrder: { number: so.tranid, po: so.otherrefnum || '', orderDate: so.trandate, shipDate: '' },
    customer: {
      name: so.addressee, attn: so.attention || so.addressee, address1: so.addr1, address2: so.addr2 || '',
      city: so.city, state: so.state, zip: so.zip, phone: so.addrphone || '', email: so.email || '',
      residential: so.isresidential === 'T',
    },
    // Open question 13: PaceJet package records not mapped yet.
    originalShipment: { source: 'not mapped yet', pallets: [] },
  };
}

// ---------------- WRITE-BACK ----------------
// Custom body fields on the Return Authorization. Proposed IDs; the NetSuite admin creates them
// (Free-Form Text) or points these env vars at existing fields.
export const RMA_FIELDS = {
  pro: () => process.env.NS_RMA_PRO_FIELD || 'custbody_rep_rl_pro',
  pickup: () => process.env.NS_RMA_PICKUP_FIELD || 'custbody_rep_rl_pickup_id',
};
export const mockRmaWrites = globalThis.__repMockRmaWrites || (globalThis.__repMockRmaWrites = new Map());

/** Save the R+L PRO and pickup # onto the RMA. Throws RepError on failure. */
export async function writeRmaFields({ rmaId, rmaNumber, proNumber, pickupId }) {
  const body = { [RMA_FIELDS.pro()]: proNumber, ...(pickupId ? { [RMA_FIELDS.pickup()]: pickupId } : {}) };
  if (!nsLive()) {
    if (process.env.MOCK_NS_WRITE_FAIL) throw new RepError('NetSuite is not responding (MOCK).', 502, 'mock write fail');
    mockRmaWrites.set(rmaNumber, { ...(mockRmaWrites.get(rmaNumber) || {}), ...body });
    return;
  }
  const host = process.env.NS_ACCOUNT_ID.toLowerCase().replace('_', '-');
  const url = `https://${host}.suitetalk.api.netsuite.com/services/rest/record/v1/returnAuthorization/${encodeURIComponent(rmaId)}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: oauthHeader('PATCH', url), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new RepError('NetSuite did not respond.', 504, { error: String(e) });
  }
  if (!res.ok) throw new RepError(`NetSuite would not save to ${rmaNumber} (${res.status}).`, 502, { status: res.status, body: await res.text() });
}
