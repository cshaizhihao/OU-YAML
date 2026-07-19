import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MihomoConfig, Project } from "../src/shared/types";

const dataDir = process.env.DATA_DIR || path.resolve("data");
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
export const db = new Database(path.join(dataDir, "ou-yaml.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
`);

export async function ensureAdmin() {
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_PASSWORD_B64
    ? Buffer.from(process.env.ADMIN_PASSWORD_B64, "base64").toString("utf8")
    : process.env.ADMIN_PASSWORD;
  const existing = db.prepare("SELECT id FROM users LIMIT 1").get();
  if (existing) return;
  if (!password || password.length < 10) throw new Error("首次启动必须设置至少 10 位的 ADMIN_PASSWORD");
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), username, await bcrypt.hash(password, 12), now);
}

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function readProject(row: Record<string, unknown>): Project {
  return {
    id: String(row.id),
    name: String(row.name),
    updatedAt: String(row.updated_at),
    config: JSON.parse(String(row.config_json)) as MihomoConfig,
  };
}
