import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = mkdtempSync(path.join(os.tmpdir(), "ou-yaml-db-migration-"));
const databasePath = path.join(dataDir, "ou-yaml.db");
const legacy = new Database(databasePath);
legacy.exec(`
  CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    config_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE managed_nodes (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_id TEXT,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    server TEXT NOT NULL,
    port INTEGER NOT NULL,
    config_json TEXT NOT NULL,
    raw_config_json TEXT,
    enabled INTEGER NOT NULL DEFAULT 1,
    tags_json TEXT NOT NULL DEFAULT '[]',
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);
legacy.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("user-a", "legacy-a", "hash", "2026-01-01T00:00:00.000Z");
legacy.prepare("INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)").run("user-b", "legacy-b", "hash", "2026-01-01T00:00:00.000Z");
const legacyConfig = JSON.stringify({ version: 1, proxies: [], proxyGroups: [], rules: [] });
legacy.prepare("INSERT INTO projects (id, user_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run("project-a", "user-a", "旧配置", legacyConfig, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
const insertNode = legacy.prepare(`INSERT INTO managed_nodes
  (id, user_id, name, type, server, port, config_json, raw_config_json, enabled, tags_json, created_at, updated_at)
  VALUES (?, ?, ?, 'ss', 'example.com', 443, ?, '{}', 1, '[]', ?, ?)`);
insertNode.run("node-a-1", "user-a", "A-1", JSON.stringify({ id: "node-a-1", name: "A-1", type: "ss", server: "example.com", port: 443, extra: {} }), "2026-01-02T00:00:00.000Z", "2026-01-02T00:00:00.000Z");
insertNode.run("node-a-2", "user-a", "A-2", JSON.stringify({ id: "node-a-2", name: "A-2", type: "ss", server: "example.com", port: 443, extra: {} }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
insertNode.run("node-b-1", "user-b", "B-1", JSON.stringify({ id: "node-b-1", name: "B-1", type: "ss", server: "example.com", port: 443, extra: {} }), "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
legacy.close();

process.env.DATA_DIR = dataDir;
const { db } = await import("../server/db");

test("旧 managed_nodes 表会补充排序字段并按用户稳定初始化", () => {
  const columns = db.prepare("PRAGMA table_info(managed_nodes)").all() as { name: string }[];
  assert.ok(columns.some((column) => column.name === "sort_order"));
  assert.deepEqual(
    (db.prepare("SELECT id, sort_order FROM managed_nodes WHERE user_id = ? ORDER BY sort_order").all("user-a") as { id: string; sort_order: number }[]),
    [{ id: "node-a-2", sort_order: 0 }, { id: "node-a-1", sort_order: 1 }],
  );
  assert.deepEqual(
    (db.prepare("SELECT id, sort_order FROM managed_nodes WHERE user_id = ? ORDER BY sort_order").all("user-b") as { id: string; sort_order: number }[]),
    [{ id: "node-b-1", sort_order: 0 }],
  );
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM schema_meta WHERE key = 'managed-node-sort-v1'").get() as { count: number }).count, 1);
  assert.ok((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_nodes'").get() as { name?: string } | undefined)?.name);
  assert.equal((db.prepare("SELECT value FROM schema_meta WHERE key = 'schema-version'").get() as { value: string }).value, "4");
});
