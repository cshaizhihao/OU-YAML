import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { MihomoConfig, Project, TargetFormat } from "../src/shared/types";

const dataDir = process.env.DATA_DIR || path.resolve("data");
process.umask(0o077);
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
try { fs.chmodSync(dataDir, 0o700); } catch { /* The database open below will report a real permission error. */ }
export const db = new Database(path.join(dataDir, "ou-yaml.db"));
for (const file of ["ou-yaml.db", "ou-yaml.db-wal", "ou-yaml.db-shm"]) {
  try { fs.chmodSync(path.join(dataDir, file), 0o600); } catch { /* SQLite creates WAL files lazily. */ }
}
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    is_disabled INTEGER NOT NULL DEFAULT 0,
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
  CREATE TABLE IF NOT EXISTS node_sources (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    url TEXT,
    format TEXT NOT NULL DEFAULT 'auto',
    enabled INTEGER NOT NULL DEFAULT 1,
    interval_minutes INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT,
    skip_cert_verify INTEGER NOT NULL DEFAULT 0,
    last_request_profile TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    last_updated_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS managed_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source_id TEXT REFERENCES node_sources(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    server TEXT NOT NULL,
    port INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    raw_config_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    tags_json TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_managed_nodes_user ON managed_nodes(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_managed_nodes_source ON managed_nodes(source_id);
  CREATE TABLE IF NOT EXISTS project_nodes (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL REFERENCES managed_nodes(id) ON DELETE CASCADE,
    alias TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    overrides_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(project_id, node_id)
  );
  CREATE INDEX IF NOT EXISTS idx_project_nodes_project ON project_nodes(project_id, sort_order);
  CREATE INDEX IF NOT EXISTS idx_project_nodes_node ON project_nodes(node_id);
  CREATE TABLE IF NOT EXISTS node_tags (
    node_id TEXT NOT NULL REFERENCES managed_nodes(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY(node_id, tag)
  );
  CREATE TABLE IF NOT EXISTS generation_profiles (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_format TEXT NOT NULL DEFAULT 'mihomo',
    config_json TEXT NOT NULL,
    node_ids_json TEXT NOT NULL DEFAULT '[]',
    source_ids_json TEXT NOT NULL DEFAULT '[]',
    template_id TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS generated_subscriptions (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL REFERENCES generation_profiles(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    target_format TEXT NOT NULL,
    token_hash TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    node_count INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT,
    revoked INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_generated_subscriptions_user ON generated_subscriptions(user_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_generated_subscriptions_token ON generated_subscriptions(token_hash);
  CREATE TABLE IF NOT EXISTS proxy_groups (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    config_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS proxy_group_members (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES proxy_groups(id) ON DELETE CASCADE,
    member_type TEXT NOT NULL,
    member_id TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    UNIQUE(group_id, member_type, member_id)
  );
  CREATE INDEX IF NOT EXISTS idx_proxy_groups_user ON proxy_groups(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS rule_sets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'custom',
    content_json TEXT NOT NULL DEFAULT '[]',
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS rule_templates (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    target_format TEXT NOT NULL DEFAULT 'mihomo',
    content_json TEXT NOT NULL DEFAULT '[]',
    is_builtin INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_rule_templates_user ON rule_templates(user_id, updated_at DESC);
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    payload_json TEXT NOT NULL DEFAULT '{}',
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);
  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );
`);

const managedNodeColumns = db.prepare("PRAGMA table_info(managed_nodes)").all() as { name: string }[];
if (!managedNodeColumns.some((column) => column.name === "sort_order")) db.exec("ALTER TABLE managed_nodes ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
db.exec("CREATE INDEX IF NOT EXISTS idx_managed_nodes_sort ON managed_nodes(user_id, sort_order, created_at, id)");
const nodeSourceColumns = db.prepare("PRAGMA table_info(node_sources)").all() as { name: string }[];
if (!nodeSourceColumns.some((column) => column.name === "interval_minutes")) db.exec("ALTER TABLE node_sources ADD COLUMN interval_minutes INTEGER NOT NULL DEFAULT 0");
if (!nodeSourceColumns.some((column) => column.name === "user_agent")) db.exec("ALTER TABLE node_sources ADD COLUMN user_agent TEXT");
if (!nodeSourceColumns.some((column) => column.name === "skip_cert_verify")) db.exec("ALTER TABLE node_sources ADD COLUMN skip_cert_verify INTEGER NOT NULL DEFAULT 0");
if (!nodeSourceColumns.some((column) => column.name === "last_request_profile")) db.exec("ALTER TABLE node_sources ADD COLUMN last_request_profile TEXT");
db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
const schemaVersion = Number((db.prepare("SELECT value FROM schema_meta WHERE key = 'schema-version'").get() as { value?: string } | undefined)?.value || 0);
if (schemaVersion < 1) db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema-version', '1') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
if (!db.prepare("SELECT 1 FROM schema_meta WHERE key = 'managed-node-sort-v1'").get()) {
  db.transaction(() => {
    const users = db.prepare("SELECT DISTINCT user_id FROM managed_nodes").all() as { user_id: string }[];
    const update = db.prepare("UPDATE managed_nodes SET sort_order = ? WHERE id = ? AND user_id = ?");
    for (const user of users) {
      const nodes = db.prepare("SELECT id FROM managed_nodes WHERE user_id = ? ORDER BY created_at ASC, id ASC").all(user.user_id) as { id: string }[];
      nodes.forEach((node, index) => update.run(index, node.id, user.user_id));
    }
    db.prepare("INSERT INTO schema_meta (key, value) VALUES ('managed-node-sort-v1', ?)").run(new Date().toISOString());
  })();
}

db.prepare("INSERT INTO schema_meta (key, value) VALUES ('schema-version', '4') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();

const userColumns = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
if (!userColumns.some((column) => column.name === "is_admin")) db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
if (!userColumns.some((column) => column.name === "is_disabled")) db.exec("ALTER TABLE users ADD COLUMN is_disabled INTEGER NOT NULL DEFAULT 0");
db.prepare("UPDATE users SET is_admin = 1 WHERE id = (SELECT id FROM users ORDER BY created_at ASC LIMIT 1) AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin = 1)").run();

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
  db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 1, 0, ?)")
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
