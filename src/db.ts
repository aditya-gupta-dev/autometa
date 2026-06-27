/**
 * Persistence layer for connected Threads accounts.
 *
 * Uses `bun:sqlite` (the project standard — no better-sqlite3). The schema is
 * intentionally small: one row per connected Threads account holding its
 * long-lived access token and when that token expires.
 */

import { Database } from "bun:sqlite";
import { config } from "./config";

const db = new Database(config.databasePath, { create: true });

// WAL improves concurrent read/write behavior for a small web service.
db.exec("PRAGMA journal_mode = WAL;");

db.exec(`
  CREATE TABLE IF NOT EXISTS threads_accounts (
    user_id        TEXT PRIMARY KEY,
    username       TEXT,
    access_token   TEXT NOT NULL,
    token_expires_at INTEGER,            -- unix seconds
    created_at     INTEGER NOT NULL,
    updated_at     INTEGER NOT NULL
  );
`);

export interface ThreadsAccount {
  user_id: string;
  username: string | null;
  access_token: string;
  token_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

const upsertStmt = db.query<unknown, [string, string | null, string, number | null, number, number]>(`
  INSERT INTO threads_accounts (user_id, username, access_token, token_expires_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET
    username         = excluded.username,
    access_token     = excluded.access_token,
    token_expires_at = excluded.token_expires_at,
    updated_at       = excluded.updated_at;
`);

export function saveAccount(params: {
  userId: string;
  username: string | null;
  accessToken: string;
  expiresInSeconds: number | null;
}): void {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = params.expiresInSeconds ? now + params.expiresInSeconds : null;
  upsertStmt.run(params.userId, params.username, params.accessToken, expiresAt, now, now);
}

const getStmt = db.query<ThreadsAccount, [string]>(
  "SELECT * FROM threads_accounts WHERE user_id = ?",
);

export function getAccount(userId: string): ThreadsAccount | null {
  return getStmt.get(userId) ?? null;
}

const listStmt = db.query<ThreadsAccount, []>(
  "SELECT * FROM threads_accounts ORDER BY created_at DESC",
);

export function listAccounts(): ThreadsAccount[] {
  return listStmt.all();
}

const deleteStmt = db.query<unknown, [string]>(
  "DELETE FROM threads_accounts WHERE user_id = ?",
);

export function deleteAccount(userId: string): void {
  deleteStmt.run(userId);
}

export { db };
