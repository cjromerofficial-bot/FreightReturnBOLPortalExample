import { handler, json, isMock, nsLive, rlLive, rlSandbox, authMode, trustedUser } from '../lib/http.mjs';
import { WAREHOUSES, FREIGHT, CARRIER } from '../config/app-config.mjs';

export default handler(async (req) => json({
  mock: isMock(),
  authMode: authMode(),
  user: trustedUser(req), // set when the hub forwards the signed-in user
  modes: { netsuite: nsLive() ? 'live' : 'mock', rl: rlLive() ? (rlSandbox() ? 'sandbox' : 'live') : 'mock' },
  warehouses: Object.values(WAREHOUSES).map(({ key, label, name, city, state, confirmed }) => ({ key, label, name, city, state, confirmed })),
  freight: FREIGHT,
  carrier: CARRIER,
}));

export const config = { path: '/api/config', method: 'GET' };
