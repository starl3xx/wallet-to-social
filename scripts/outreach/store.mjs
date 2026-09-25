import { DatabaseSync } from 'node:sqlite';
import {
  mkdirSync,
  openSync,
  closeSync,
  writeFileSync,
  unlinkSync,
  chmodSync,
} from 'node:fs';
import { join } from 'node:path';

export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const lock = join(directory, 'runner.lock');
  let descriptor;
  try {
    descriptor = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if (error.code === 'EEXIST')
      throw new Error(
        'Another outreach command holds runner.lock. After a crash, verify its PID has stopped before removing the lock.'
      );
    throw error;
  }
  writeFileSync(
    descriptor,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })
  );
  let db;
  try {
    const filename = join(directory, 'outreach.sqlite');
    db = new DatabaseSync(filename);
    chmodSync(filename, 0o600);
    db.exec(
      'PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK (id = 1), payload TEXT NOT NULL)'
    );
  } catch (error) {
    db?.close();
    closeSync(descriptor);
    unlinkSync(lock);
    throw error;
  }
  return {
    load() {
      const row = db.prepare('SELECT payload FROM state WHERE id = 1').get();
      if (!row) return null;
      const state = JSON.parse(row.payload);
      if (state.version !== 1)
        throw new Error('Unsupported outreach database version');
      return state;
    },
    save(state) {
      db.prepare(
        'INSERT INTO state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload = excluded.payload'
      ).run(JSON.stringify(state));
    },
    close() {
      db.close();
      closeSync(descriptor);
      unlinkSync(lock);
    },
  };
}
