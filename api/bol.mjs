import { handler, json, RepError } from '../lib/http.mjs';
import { getRecord } from '../lib/returns.mjs';

// Full saved BOL record (used by Reprint and "Duplicate & edit").
export default handler(async (req) => {
  const rec = await getRecord(new URL(req.url).searchParams.get('bol') || '');
  if (!rec) throw new RepError("We couldn't find that BOL.", 404);
  return json(rec);
});

export const config = { path: '/api/bol', method: 'GET' };
