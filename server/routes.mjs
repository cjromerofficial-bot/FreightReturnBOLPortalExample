// Every API route, imported statically so bundlers (Vercel) can trace them.
import * as appConfig from '../routes/app-config.mjs';
import * as bol from '../routes/bol.mjs';
import * as createBol from '../routes/create-bol.mjs';
import * as document from '../routes/document.mjs';
import * as history from '../routes/history.mjs';
import * as login from '../routes/login.mjs';
import * as lookup from '../routes/lookup.mjs';
import * as parseDoc from '../routes/parse-doc.mjs';
import * as quote from '../routes/quote.mjs';
import * as retryPickup from '../routes/retry-pickup.mjs';
import * as retryWriteback from '../routes/retry-writeback.mjs';
import * as voidBol from '../routes/void-bol.mjs';

export const ROUTES = Object.fromEntries(
  [appConfig, bol, createBol, document, history, login, lookup, parseDoc, quote, retryPickup, retryWriteback, voidBol].map((m) => [m.config.path, { fn: m.default, method: m.config.method }]),
);
