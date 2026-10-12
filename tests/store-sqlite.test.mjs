// SQLite store: the Docker/hub default. Atomic create-if-missing is what prevents duplicate BOLs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../lib/store.mjs';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'frp-')), 'freight.db');

test('get / set / list / delete round-trip', async () => {
  const s = openDb(file);
  await s.set('bol/A', { pro: '1' });
  await s.set('bol/B', { pro: '2' });
  await s.set('log/x', { a: 1 });
  assert.deepEqual(await s.get('bol/A'), { pro: '1' });
  assert.deepEqual(await s.list('bol/'), ['bol/A', 'bol/B']);
  await s.delete('bol/A');
  assert.equal(await s.get('bol/A'), null);
});

test('20 concurrent setIfNew calls -> exactly one winner', async () => {
  const s = openDb(file);
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => s.setIfNew('bol-active/RMA1', { who: i })));
  assert.equal(results.filter(Boolean).length, 1);
});

test('data survives closing and reopening the database (container restart)', async () => {
  openDb(file).close();
  const s = openDb(file);
  assert.deepEqual(await s.get('bol/B'), { pro: '2' });
  assert.equal(await s.setIfNew('bol-active/RMA1', {}), false, 'lock still held after restart');
  s.close();
});
