import { handler, json, readJson, repNameFrom } from '../lib/http.mjs';
import { retryPickup } from '../lib/returns.mjs';

export default handler(async (req) => {
  const body = await readJson(req);
  return json(await retryPickup({ bolNumber: body.bolNumber, pickup: body.pickup, repName: repNameFrom(body, req) }));
}, { limit: 10 });

export const config = { path: '/api/retry-pickup', method: 'POST' };
