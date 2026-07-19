import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MihomoConfig, Project, TargetFormat } from "../src/shared/types";

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
    updated_at TEXT NOT NULL,
    target_format TEXT NOT NULL DEFAULT 'mihomo'
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    format TEXT NOT NULL DEFAULT 'auto',
    interval_minutes INTEGER NOT NULL DEFAULT 0,
    last_updated_at TEXT,
    last_error TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS project_versions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    config_json TEXT NOT NULL,
    target_format TEXT NOT NULL,
    proxy_count INTEGER NOT NULL,
    group_count INTEGER NOT NULL,
    rule_count INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_subscriptions_project ON subscriptions(project_id);
  CREATE INDEX IF NOT EXISTS idx_versions_project ON project_versions(project_id, created_at DESC);
`);

const projectColumns = db.prepare("PRAGMA table_info(projects)").all() as { name: string }[];
if (!projectColumns.some((column) => column.name === "target_format")) db.exec("ALTER TABLE projects ADD COLUMN target_format TEXT NOT NULL DEFAULT 'mihomo'");

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
    targetFormat: (row.target_format === "sing-box" ? "sing-box" : "mihomo") as TargetFormat,
  };
}

export function snapshotProject(projectId: string, userId: string, label: string, force = true) {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(projectId, userId) as Record<string, unknown> | undefined;
  if (!project) return false;
  if (!force) {
    const recent = db.prepare("SELECT created_at FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(projectId) as { created_at: string } | undefined;
    if (recent && Date.now() - new Date(recent.created_at).getTime() < 10 * 60 * 1000) return false;
  }
  const config = JSON.parse(String(project.config_json)) as MihomoConfig;
  db.prepare(`INSERT INTO project_versions (id, project_id, label, config_json, target_format, proxy_count, group_count, rule_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), projectId, label.slice(0, 80), project.config_json, project.target_format || "mihomo", config.proxies.length, config.proxyGroups.length, config.rules.length, new Date().toISOString());
  const oldVersions = db.prepare("SELECT id FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 50").all(projectId) as { id: string }[];
  if (oldVersions.length) db.prepare(`DELETE FROM project_versions WHERE id IN (${oldVersions.map(() => "?").join(",")})`).run(...oldVersions.map((item) => item.id));
  return true;
}
