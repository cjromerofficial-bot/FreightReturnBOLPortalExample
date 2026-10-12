import { handler, RepError } from '../lib/http.mjs';
import { store } from '../lib/store.mjs';
import { renderBol } from '../lib/pdf/bol.mjs';
import { renderPackingList } from '../lib/pdf/packing.mjs';
import { renderLabels4x6, renderLabelsLetter } from '../lib/pdf/label.mjs';
import { renderBundle } from '../lib/pdf/bundle.mjs';

const RENDERERS = {
  bol: [renderBol, 'BOL'],
  packing: [renderPackingList, 'PackingList'],
  labels4x6: [renderLabels4x6, 'Labels_4x6'],
  labelsLetter: [renderLabelsLetter, 'Labels_Letter'],
  bundle: [renderBundle, 'Return_Documents'],
};

export default handler(async (req) => {
  const url = new URL(req.url);
  const bol = url.searchParams.get('bol') || '';
  const type = url.searchParams.get('type') || 'bol';
  const [render, name] = RENDERERS[type] || [];
  if (!render) throw new RepError('Unknown document type.', 404);
  const rec = await store().get(`bol/${bol}`);
  if (!rec) throw new RepError('We couldn\'t find that BOL. Search for it on the history page.', 404);
  const pdf = await render(rec);
  return new Response(pdf, {
    headers: { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}_${rec.rmaNumber}_${rec.proNumber}.pdf"` },
  });
});

export const config = { path: '/api/document', method: 'GET' };
