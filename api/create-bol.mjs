import { handler, json, readJson, repNameFrom } from '../lib/http.mjs';
import { createBol } from '../lib/returns.mjs';

export default handler(async (req) => {
  const body = await readJson(req);
  const record = await createBol({ ...body, repName: repNameFrom(body, req) });
  return json(record);
}, { limit: 10 });

export const config = { path: '/api/create-bol', method: 'POST' };
