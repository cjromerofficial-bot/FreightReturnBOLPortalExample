import { handler, json, readJson, repNameFrom } from '../lib/http.mjs';
import { retryWriteBack } from '../lib/returns.mjs';

export default handler(async (req) => {
  const body = await readJson(req);
  return json(await retryWriteBack({ bolNumber: body.bolNumber, repName: repNameFrom(body, req) }));
}, { limit: 10 });

export const config = { path: '/api/retry-writeback', method: 'POST' };
