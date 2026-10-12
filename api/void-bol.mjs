import { handler, json, readJson, repNameFrom } from '../lib/http.mjs';
import { voidBol } from '../lib/returns.mjs';

export default handler(async (req) => {
  const body = await readJson(req);
  return json(await voidBol({ bolNumber: body.bolNumber, reason: body.reason, confirmedRlVoid: body.confirmedRlVoid, repName: repNameFrom(body, req) }));
}, { limit: 10 });

export const config = { path: '/api/void-bol', method: 'POST' };
