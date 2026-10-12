// Read an original PaceJet BOL or packing list PDF and pull out the containers.
//   BOL row:          "1 - (Pallet) | 96x40x20 | IN | 620.4 | Home Gym Equipment | 015520-08 | 85"
//   Packing list row: "#1 - Pallet 96x40x20 (620.4-LB) | Track ID:555000111"  then  "SO9990001 | BB-1120 | Delta Basic Bar | 1 | Ea"
// Server-side only. PDFs are untrusted input: pdf.js runs with eval disabled and nothing is executed.

/** PDF bytes -> text lines (cells joined with " | "), top to bottom, page by page. */
export async function pdfLines(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: true, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 10); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    const rows = new Map();
    for (const it of tc.items) {
      if (!it.str?.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...rows.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      (rows.get(key) || rows.set(key, []).get(key)).push([it.transform[4], it.str.trim()]);
    }
    for (const [, parts] of [...rows].sort((a, b) => b[0] - a[0])) out.push(parts.sort((a, b) => a[0] - b[0]).map((p) => p[1]).join(' | '));
  }
  await doc.destroy();
  return out;
}

const num = (s) => Number(String(s).replace(/,/g, ''));

/** Text lines -> { kind, ifNumber, salesOrder, pro, containers:[{type,length,width,height,weightLb,nmfc,freightClass,items:[{sku,qty}]}] } */
export function parseShipmentDoc(lines) {
  const all = lines.join('\n');
  const kind = /Packing List/i.test(all) ? 'packing-list' : /BILL OF LADING/i.test(all) ? 'bol' : 'unknown';
  const ifNumber = (all.match(/\b(IF\d{5,})\b/) || [])[1] || '';
  const salesOrder = (all.match(/\b(SO\d{5,})\b/) || [])[1] || '';
  const pro = (all.match(/MSTR TRACKID \| (\w+)/) || all.match(/Track ID:\s*(\w+)/) || all.match(/\*(\w{6,})\*/) || [])[1] || '';
  const containers = [];

  if (kind === 'packing-list') {
    let cur = null;
    for (const line of lines) {
      const c = line.match(/#\d+\s*-\s*(Pallet|Crate)\s+(\d+)x(\d+)x(\d+)\s*\(([\d,.]+)-LB\)/i);
      if (c) { cur = { type: cap(c[1]), length: +c[2], width: +c[3], height: +c[4], weightLb: num(c[5]), items: [] }; containers.push(cur); continue; }
      const it = cur && line.match(/^(SO\d+) \| ([A-Z0-9][A-Z0-9-]*) \| .*? \| (\d+) \| Ea/i);
      if (it) cur.items.push({ sku: it[2], qty: +it[3] });
    }
  } else {
    for (const line of lines) {
      const r = line.match(/^(\d+)\s*-\s*\((Pallet|Crate|Skid)\)\s*\|\s*(\d+)x(\d+)x(\d+)\s*\|\s*IN\s*\|\s*([\d,.]+)(?:\s*\|.*?\|\s*(\d{6}(?:-\d{2})?)\s*\|\s*([\d.]+))?/i);
      if (!r) continue;
      for (let i = 0; i < +r[1]; i++) {
        containers.push({ type: cap(r[2]) === 'Skid' ? 'Pallet' : cap(r[2]), length: +r[3], width: +r[4], height: +r[5], weightLb: num(r[6]) / +r[1], nmfc: r[7] || '', freightClass: r[8] || '', items: [] });
      }
    }
  }
  return { kind, ifNumber, salesOrder, pro, containers };
}
const cap = (s) => s[0].toUpperCase() + s.slice(1).toLowerCase();

/**
 * Build the return's pallets from a parsed original document.
 * Packing list: RMA items go on the container they originally shipped on (matched by SKU).
 * BOL only: container sizes are exact; items are placed by the smart-guess rules (crate items -> crates).
 */
export function palletsFromDoc(parsed, rmaLines, suggest) {
  const boxes = parsed.containers.map((c, i) => ({ id: `d${i + 1}`, type: c.type, length: c.length, width: c.width, height: c.height, items: [], freightClass: '', nmfc: '', classManual: false, reason: `From the original ${parsed.kind === 'bol' ? 'BOL' : 'packing list'} (container #${i + 1})` }));
  const left = new Map(rmaLines.map((l) => [l.lineId, l.qty]));
  const put = (box, line, qty) => { if (qty <= 0) return; const ex = box.items.find((x) => x.lineId === line.lineId); if (ex) ex.qty += qty; else box.items.push({ lineId: line.lineId, qty }); left.set(line.lineId, left.get(line.lineId) - qty); };

  if (parsed.kind === 'packing-list') {
    parsed.containers.forEach((c, i) => {
      for (const it of c.items) {
        const line = rmaLines.find((l) => l.sku.toUpperCase().startsWith(it.sku.toUpperCase()) || it.sku.toUpperCase().startsWith(l.sku.toUpperCase()));
        if (line) put(boxes[i], line, Math.min(it.qty, left.get(line.lineId)));
      }
    });
  } else {
    // Match each guessed container to the closest-sized document container
    // (PaceJet labels crates "(Pallet)", so compare sizes, not labels).
    const guess = suggest(rmaLines);
    const diff = (a, b) => Math.abs(a.length - b.length) + Math.abs(a.width - b.width) + Math.abs(a.height - b.height);
    for (const g of guess) {
      const free = boxes.filter((b) => !b._used);
      const target = [...(free.length ? free : boxes)].sort((a, b) => diff(a, g) - diff(b, g))[0];
      if (!target) break;
      target._used = true;
      for (const it of g.items) put(target, rmaLines.find((l) => l.lineId === it.lineId), it.qty);
    }
  }
  // Anything not matched goes on the biggest pallet so nothing is lost; the rep can move it.
  const unmatched = rmaLines.filter((l) => left.get(l.lineId) > 0);
  if (unmatched.length && boxes.length) {
    const big = [...boxes].sort((a, b) => b.length * b.width - a.length * a.width)[0];
    for (const l of unmatched) put(big, l, left.get(l.lineId));
  }
  const used = boxes.filter((b) => b.items.length).map(({ _used, ...b }, i) => ({ ...b, id: `d${i + 1}` }));
  return { pallets: used, unmatched: unmatched.map((l) => l.sku), dropped: boxes.length - used.length };
}
