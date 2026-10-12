import { handler, json, RepError, logTech } from '../lib/http.mjs';
import { lookupRma } from '../lib/netsuite.mjs';
import { pdfLines, parseShipmentDoc, palletsFromDoc } from '../lib/docparse.mjs';
import { suggestPallets } from '../lib/packaging.mjs';
import { autoClass } from '../lib/freight.mjs';

const MAX_BYTES = 6 * 1024 * 1024;

// Body: the raw PDF (original PaceJet BOL or packing list). ?rma= the RMA being returned.
// Nothing is stored; the file is read in memory and discarded.
export default handler(async (req) => {
  const rma = new URL(req.url).searchParams.get('rma') || '';
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) throw new RepError('That file was empty.');
  if (bytes.length > MAX_BYTES) throw new RepError('That file is too big. Use the PDF of the original BOL or packing list.');
  if (bytes.subarray(0, 5).toString('latin1') !== '%PDF-') throw new RepError('That isn\'t a PDF. Drop the original BOL or packing list PDF from PaceJet.');
  const data = await lookupRma(rma);
  let parsed;
  try {
    parsed = parseShipmentDoc(await pdfLines(bytes));
  } catch (e) {
    logTech('/api/parse-doc', e);
    throw new RepError('We couldn\'t read that PDF. Pick the pallet sizes instead.');
  }
  if (!parsed.containers.length)
    throw new RepError('We couldn\'t find any pallets or crates in that PDF. Make sure it\'s the original BOL or packing list.');
  const built = palletsFromDoc(parsed, data.rma.lines, suggestPallets);
  return json({
    kind: parsed.kind, ifNumber: parsed.ifNumber, salesOrder: parsed.salesOrder, pro: parsed.pro,
    containers: parsed.containers.map(({ items, ...c }) => ({ ...c, itemCount: items.length })),
    soMismatch: !!(parsed.salesOrder && data.salesOrder.number && parsed.salesOrder !== data.salesOrder.number),
    pallets: built.pallets.map((p) => autoClass(p, data.rma.lines)),
    unmatched: built.unmatched,
    dropped: built.dropped,
  });
}, { limit: 20 });

export const config = { path: '/api/parse-doc', method: 'POST' };
