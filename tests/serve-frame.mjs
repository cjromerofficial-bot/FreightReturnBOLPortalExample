// Dev helper: a fake "hub" page on another origin that frames the portal (checks frame-ancestors).
import http from 'node:http';
import fs from 'node:fs';
http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fs.readFileSync('tests/fixtures/hub-frame.html')); }).listen(5056);
