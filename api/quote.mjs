import { handler, json, readJson, repNameFrom } from '../lib/http.mjs';
import { quote } from '../lib/returns.mjs';

export default handler(async (req) => {
  const body = await readJson(req);
  return json(await quote({ shipment: body.shipment, repName: repNameFrom(body, req) }));
}, { limit: 20 });

export const config = { path: '/api/quote', method: 'POST' };
