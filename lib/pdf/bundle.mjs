// "Download all": BOL + packing list + letter-size labels in one PDF for the customer email.
import { PDFDocument } from 'pdf-lib';
import { renderBol } from './bol.mjs';
import { renderPackingList } from './packing.mjs';
import { addLetterLabels } from './label.mjs';

export async function renderBundle(rec) {
  const out = await PDFDocument.create();
  for (const bytes of [await renderBol(rec), await renderPackingList(rec)]) {
    const src = await PDFDocument.load(bytes);
    for (const pg of await out.copyPages(src, src.getPageIndices())) out.addPage(pg);
  }
  await addLetterLabels(out, rec);
  out.setTitle(`Return ${rec.rmaNumber} - PRO ${rec.proNumber}`);
  return out.save();
}
