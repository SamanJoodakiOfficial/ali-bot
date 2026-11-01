import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class Store {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS clients (
        email TEXT PRIMARY KEY,
        client_id INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        expiry_time INTEGER,
        expiry_raw INTEGER,
        enabled INTEGER,
        total_bytes INTEGER,
        used_bytes INTEGER,
        client_group TEXT,
        comment TEXT,
        inbound_ids TEXT NOT NULL DEFAULT '[]',
        last_seen_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS clients_created_at_idx ON clients(created_at DESC);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        telegram_id TEXT NOT NULL,
        action TEXT NOT NULL,
        result TEXT NOT NULL,
        at INTEGER NOT NULL
      );
    `);
    this.upsert = this.db.prepare(`
      INSERT INTO clients(email,client_id,created_at,updated_at,expiry_time,expiry_raw,enabled,
                          total_bytes,used_bytes,client_group,comment,inbound_ids,last_seen_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET
        client_id=excluded.client_id,created_at=excluded.created_at,
        updated_at=excluded.updated_at,expiry_time=excluded.expiry_time,
        expiry_raw=excluded.expiry_raw,enabled=excluded.enabled,
        total_bytes=excluded.total_bytes,used_bytes=excluded.used_bytes,
        client_group=excluded.client_group,comment=excluded.comment,
        inbound_ids=excluded.inbound_ids,last_seen_at=excluded.last_seen_at
    `);
  }

  set(key, value) {
    this.db.prepare(`INSERT INTO kv(key,value) VALUES(?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(key, String(value));
  }

  get(key) { return this.db.prepare('SELECT value FROM kv WHERE key=?').get(key)?.value ?? null; }

  remember(clients) {
    const now = Date.now();
    this.db.exec('BEGIN');
    try {
      for (const c of clients) {
        this.upsert.run(c.email, c.id, c.createdAt, c.updatedAt,
          c.expiryTime, c.expiryRaw, c.enabled === null ? null : Number(c.enabled),
          c.totalBytes, c.usedBytes, c.group, c.comment,
          JSON.stringify(c.inboundIds), now);
      }
      this.set('last_success_at', String(now));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  cachedLatest(limit = 10) {
    const rows = this.db.prepare(`SELECT * FROM clients
      ORDER BY (created_at IS NULL) ASC, created_at DESC, client_id DESC, email ASC
      LIMIT ?`).all(limit);
    return rows.map(r => ({
      email: r.email, id: r.client_id, createdAt: r.created_at, updatedAt: r.updated_at,
      expiryTime: r.expiry_time, expiryRaw: r.expiry_raw,
      enabled: r.enabled === null ? null : Boolean(r.enabled),
      totalBytes: r.total_bytes, usedBytes: r.used_bytes,
      group: r.client_group, comment: r.comment,
      inboundIds: JSON.parse(r.inbound_ids),
    }));
  }

  cachedCount() { return this.db.prepare('SELECT count(*) AS c FROM clients').get().c; }

  audit(telegramId, action, result = 'ok') {
    this.db.prepare('INSERT INTO audit(telegram_id,action,result,at) VALUES(?,?,?,?)')
      .run(String(telegramId), String(action).slice(0, 40), String(result).slice(0, 20), Date.now());
    // Prevent unbounded audit storage. Keep 2000 latest events.
    this.db.exec('DELETE FROM audit WHERE id < (SELECT COALESCE(MAX(id)-2000, 0) FROM audit)');
  }

  close() { this.db.close(); }
}
