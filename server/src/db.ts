import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type HistoryAction =
  | "image_to_base64"
  | "base64_to_image"
  | "upload"
  | "batch_upload"
  | "openai_vision_strategy";

export function openDb(dbPath: string) {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_history_ip ON history(ip);
    CREATE INDEX IF NOT EXISTS idx_history_created ON history(created_at);
  `);
  return db;
}

export type HistoryRow = {
  id: number;
  ip: string;
  action: HistoryAction;
  detail: unknown;
  created_at: number;
};

export function insertHistory(
  db: Database.Database,
  ip: string,
  action: HistoryAction,
  detail: unknown
) {
  const stmt = db.prepare(
    `INSERT INTO history (ip, action, detail, created_at) VALUES (@ip, @action, @detail, @created_at)`
  );
  stmt.run({
    ip,
    action,
    detail: detail == null ? null : JSON.stringify(detail),
    created_at: Date.now(),
  });
}

export function listHistoryByIp(
  db: Database.Database,
  ip: string,
  limit = 100
): HistoryRow[] {
  const rows = db
    .prepare(
      `SELECT id, ip, action, detail, created_at FROM history WHERE ip = ? ORDER BY id DESC LIMIT ?`
    )
    .all(ip, limit) as {
    id: number;
    ip: string;
    action: string;
    detail: string | null;
    created_at: number;
  }[];
  return rows.map((r) => ({
    ...r,
    action: r.action as HistoryAction,
    detail: r.detail ? JSON.parse(r.detail) : null,
  }));
}
