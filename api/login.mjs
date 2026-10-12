import { handler, json, readJson, checkPassword, sessionCookie, RepError } from '../lib/http.mjs';

export default handler(async (req) => {
  const { password } = await readJson(req);
  if (!checkPassword(password)) throw new RepError('That password isn\'t right. Ask your lead for the portal password.', 401);
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie() });
}, { auth: false, limit: 10 });

export const config = { path: '/api/login', method: 'POST' };
