import { handler, json, readJson } from '../lib/http.mjs';
import { lookup } from '../lib/returns.mjs';

export default handler(async (req) => {
  const { rmaNumber } = await readJson(req);
  const data = await lookup(rmaNumber);
  // Email is only needed by the rep for sending documents; everything else drives the form.
  return json(data);
});

export const config = { path: '/api/lookup', method: 'POST' };
