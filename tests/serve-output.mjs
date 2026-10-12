// Dev helper: renders test-output/*.pdf in a browser via pdf.js for visual checks.
// Open http://localhost:5055/view?f=BOL_a_residential_CA.pdf
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('test-output');
const pdfjs = path.resolve('node_modules/pdfjs-dist/build');
const page = (f) => `<!doctype html><body style="margin:0;background:#888">
<canvas id=c style="display:block;margin:auto;background:#fff"></canvas>
<script type=module>
import * as p from '/pdfjs/pdf.min.mjs';
p.GlobalWorkerOptions.workerSrc='/pdfjs/pdf.worker.min.mjs';
const d=await p.getDocument('/pdf/${f}').promise; const pg=await d.getPage(1);
const v=pg.getViewport({scale:Number(new URLSearchParams(location.search).get('s')||1.4)}); const c=document.getElementById('c');
c.width=v.width;c.height=v.height; await pg.render({canvasContext:c.getContext('2d'),viewport:v}).promise; document.title='done';
</script>`;
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const send = (file, type) => { res.writeHead(200, { 'content-type': type }); fs.createReadStream(file).pipe(res); };
  if (u.pathname.startsWith('/pdfjs/')) return send(path.join(pdfjs, path.basename(u.pathname)), 'text/javascript');
  if (u.pathname.startsWith('/pdf/')) return send(path.join(out, path.basename(u.pathname)), 'application/octet-stream');
  if (u.pathname === '/view') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(path.basename(u.searchParams.get('f')))); }
  res.end(fs.readdirSync(out).join('\n'));
}).listen(5055);
