import { handler, json } from '../lib/http.mjs';
import { history } from '../lib/returns.mjs';

export default handler(async (req) => json(await history({ q: new URL(req.url).searchParams.get('q') || '' })));

export const config = { path: '/api/history', method: 'GET' };
