// Vercel serverless entry point. vercel.json rewrites every /api/<route> request here as
// /api/router?route=<route>; this dispatches to the same handlers the Node server uses.
//
// Demo storage: in-memory (STORE=memory). Data lives as long as the function instance stays warm,
// so a cold start resets history. That's fine for a portfolio demo running on mock data.
process.env.STORE ||= 'memory';
process.env.APP_MODE ||= 'mock';

const { ROUTES } = await import('../server/routes.mjs');

async function dispatch(request) {
  const url = new URL(request.url);
  const route = (url.searchParams.get('route') || '').replace(/^\/+|\/+$/g, '');
  url.searchParams.delete('route');
  url.pathname = `/api/${route}`;
  const target = ROUTES[url.pathname];
  if (!target) return Response.json({ error: 'Not found' }, { status: 404 });
  if (target.method && request.method !== target.method) return new Response(null, { status: 405 });
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  return target.fn(new Request(url, { method: request.method, headers: request.headers, body }));
}

export const GET = dispatch;
export const POST = dispatch;
