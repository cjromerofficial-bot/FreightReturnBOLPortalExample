export class ApiError extends Error {
  constructor(body, status) {
    super(body.error || 'Something went wrong.');
    Object.assign(this, body, { status });
  }
}

export async function api(path, body) {
  const res = await fetch(path, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) throw new ApiError(data, res.status);
  return data;
}

export const docUrl = (bol, type = 'bol') => `api/document?bol=${encodeURIComponent(bol)}&type=${type}`;

export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));

export function remember(key, value) {
  try { if (value === undefined) return localStorage.getItem(key) || ''; localStorage.setItem(key, value); } catch { return ''; }
  return value;
}
