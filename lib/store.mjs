// Persistent key/value store.
//   STORE=sqlite (default): a single SQLite file at DATA_DIR/freight.db (Docker volume /data).
//   STORE=memory: in-process only, for tests.
// Values are JSON. setIfNew is atomic — it is what makes duplicate BOLs/pickups impossible.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const memory = globalThis.__repMemStore || (globalThis.__repMemStore = new Map());

function memoryStore() {
  return {
    async get(key) { return memory.has(key) ? structuredClone(memory.get(key)) : null; },
    async set(key, value) { memory.set(key, structuredClone(value)); },
    async setIfNew(key, value) {
      if (memory.has(key)) return false;
      memory.set(key, structuredClone(value));
      return true;
    },
    async delete(key) { memory.delete(key); },
    async list(prefix) { return [...memory.keys()].filter((k) => k.startsWith(prefix)); },
  };
}

const dbs = new Map();
export function openDb(file = path.join(process.env.DATA_DIR || './data', 'freight.db')) {
  if (dbs.has(file)) return dbs.get(file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
           CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  const q = {
    get: db.prepare('SELECT value FROM kv WHERE key = ?'),
    set: db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'),
    insertNew: db.prepare('INSERT OR IGNORE INTO kv (key, value) VALUES (?, ?)'),
    del: db.prepare('DELETE FROM kv WHERE key = ?'),
    list: db.prepare("SELECT key FROM kv WHERE key >= ? AND key < ? || char(1114111) ORDER BY key"),
  };
  const s = {
    db,
    async get(key) { const r = q.get.get(key); return r ? JSON.parse(r.value) : null; },
    async set(key, value) { q.set.run(key, JSON.stringify(value)); },
    async setIfNew(key, value) { return q.insertNew.run(key, JSON.stringify(value)).changes === 1; },
    async delete(key) { q.del.run(key); },
    async list(prefix) { return q.list.all(prefix, prefix).map((r) => r.key); },
    close() { db.close(); dbs.delete(file); },
  };
  dbs.set(file, s);
  return s;
}

export const store = () => (process.env.STORE === 'memory' ? memoryStore() : openDb());
/** Tests only: wipe whichever store is active. */
export function resetMemoryStore() {
  memory.clear();
  if (process.env.STORE !== 'memory') openDb().db.exec('DELETE FROM kv');
}
