import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { db, ensureAdmin, hashToken, readProject, snapshotProject } from "./db";
import { exportMihomoYaml, validateConfig } from "../src/shared/mihomo";
import { exportSingBoxJson } from "../src/shared/singbox";
import { createEmptyConfig, type MihomoConfig, type Subscription, type TargetFormat } from "../src/shared/types";
import { mergeSubscriptionNodes, parseImportedContent, type ImportFormat } from "./importer";
import { safeFetchText } from "./safeFetch";

declare global {
  namespace Express { interface Request { user?: { id: string; username: string } } }
}

await ensureAdmin();
const app = express();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === "production";

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet({ contentSecurityPolicy: isProduction ? undefined : false }));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false });
const loginSchema = z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) });
const subscriptionSchema = z.object({
  name: z.string().trim().min(1).max(80),
  url: z.string().url().max(2048).refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }),
  format: z.enum(["auto", "links", "mihomo", "sing-box"]).default("auto"),
  intervalMinutes: z.number().int().min(0).max(10080).default(0),
});

function readSubscription(row: Record<string, unknown>): Subscription {
  return {
    id: String(row.id), projectId: String(row.project_id), name: String(row.name), url: String(row.url),
    format: String(row.format) as Subscription["format"], intervalMinutes: Number(row.interval_minutes),
    lastUpdatedAt: row.last_updated_at ? String(row.last_updated_at) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined, nodeCount: Number(row.node_count), createdAt: String(row.created_at),
  };
}

async function refreshSubscription(subscriptionId: string, userId: string) {
  const row = db.prepare(`SELECT subscriptions.*, projects.config_json, projects.target_format
    FROM subscriptions JOIN projects ON projects.id = subscriptions.project_id
    WHERE subscriptions.id = ? AND projects.user_id = ?`).get(subscriptionId, userId) as Record<string, unknown> | undefined;
  if (!row) throw new Error("订阅不存在");
  try {
    const content = await safeFetchText(String(row.url));
    const imported = parseImportedContent(content, String(row.format) as ImportFormat);
    const config = mergeSubscriptionNodes(JSON.parse(String(row.config_json)) as MihomoConfig, subscriptionId, imported.nodes);
    snapshotProject(String(row.project_id), userId, `订阅更新前：${String(row.name)}`, true);
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(config), now, row.project_id);
      db.prepare("UPDATE subscriptions SET last_updated_at = ?, last_error = NULL, node_count = ?, updated_at = ? WHERE id = ?")
        .run(now, imported.nodes.length, now, subscriptionId);
    })();
    return { subscription: readSubscription(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(subscriptionId) as Record<string, unknown>), config, warnings: imported.warnings };
  } catch (error) {
    const message = error instanceof Error ? error.message : "订阅更新失败";
    db.prepare("UPDATE subscriptions SET last_error = ?, updated_at = ? WHERE id = ?").run(message.slice(0, 500), new Date().toISOString(), subscriptionId);
    throw new Error(message);
  }
}

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "请输入账号和密码" });
  const user = db.prepare("SELECT id, username, password_hash FROM users WHERE username = ?").get(parsed.data.username) as { id: string; username: string; password_hash: string } | undefined;
  if (!user || !await bcrypt.compare(parsed.data.password, user.password_hash)) return res.status(401).json({ error: "账号或密码错误" });
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date().toISOString());
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").run(hashToken(token), user.id, expires.toISOString());
  res.cookie("ou_session", token, { httpOnly: true, sameSite: "strict", secure: process.env.COOKIE_SECURE === "true" || req.secure, expires, path: "/" });
  return res.json({ username: user.username });
});

function authenticatedUser(req: Request) {
  const token = req.cookies.ou_session;
  if (!token) return undefined;
  return db.prepare(`SELECT users.id, users.username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
    .get(hashToken(token), new Date().toISOString()) as { id: string; username: string } | undefined;
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const row = authenticatedUser(req);
  if (!row) return res.status(401).json({ error: "登录已过期" });
  req.user = row;
  next();
}

app.get("/api/auth/me", (req, res) => res.json({ username: authenticatedUser(req)?.username || null }));
app.post("/api/auth/logout", requireAuth, (req, res) => {
  db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(req.cookies.ou_session));
  res.clearCookie("ou_session", { path: "/" });
  res.status(204).end();
});

app.get("/api/projects", requireAuth, (req, res) => {
  const rows = db.prepare("SELECT id, name, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC").all(req.user!.id);
  res.json(rows.map((row) => ({ id: String((row as any).id), name: String((row as any).name), updatedAt: String((row as any).updated_at) })));
});

app.post("/api/projects", requireAuth, (req, res) => {
  const name = typeof req.body?.name === "string" && req.body.name.trim() ? req.body.name.trim().slice(0, 80) : "新配置";
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare("INSERT INTO projects (id, user_id, name, config_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, req.user!.id, name, JSON.stringify(createEmptyConfig()), now, now);
  res.status(201).json(readProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as Record<string, unknown>));
});

app.get("/api/projects/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id) as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "项目不存在" });
  res.json(readProject(row));
});

app.put("/api/projects/:id", requireAuth, (req, res) => {
  const config = req.body?.config as MihomoConfig | undefined;
  if (!config || config.version !== 1 || !Array.isArray(config.proxies) || !Array.isArray(config.proxyGroups) || !Array.isArray(config.rules)) return res.status(400).json({ error: "配置数据无效" });
  const name = typeof req.body.name === "string" ? req.body.name.trim().slice(0, 80) : "未命名配置";
  const targetFormat: TargetFormat = req.body.targetFormat === "sing-box" ? "sing-box" : "mihomo";
  const now = new Date().toISOString();
  const current = db.prepare("SELECT config_json FROM projects WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id) as { config_json: string } | undefined;
  if (current && current.config_json !== JSON.stringify(config)) snapshotProject(String(req.params.id), req.user!.id, "自动保存", false);
  const result = db.prepare("UPDATE projects SET name = ?, config_json = ?, target_format = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(name || "未命名配置", JSON.stringify(config), targetFormat, now, req.params.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "项目不存在" });
  res.json({ id: req.params.id, name: name || "未命名配置", updatedAt: now });
});

app.delete("/api/projects/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "项目不存在" });
  res.status(204).end();
});

app.get("/api/projects/:id/subscriptions", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT subscriptions.* FROM subscriptions JOIN projects ON projects.id = subscriptions.project_id
    WHERE subscriptions.project_id = ? AND projects.user_id = ? ORDER BY subscriptions.created_at DESC`).all(req.params.id, req.user!.id) as Record<string, unknown>[];
  res.json(rows.map(readSubscription));
});

app.post("/api/projects/:id/subscriptions", requireAuth, async (req, res) => {
  const project = db.prepare("SELECT id FROM projects WHERE id = ? AND user_id = ?").get(req.params.id, req.user!.id);
  if (!project) return res.status(404).json({ error: "项目不存在" });
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "订阅名称、地址或更新间隔无效" });
  const id = randomUUID(); const now = new Date().toISOString();
  db.prepare(`INSERT INTO subscriptions (id, project_id, name, url, format, interval_minutes, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.params.id, parsed.data.name, parsed.data.url, parsed.data.format, parsed.data.intervalMinutes, now, now);
  if (req.body.updateNow === false) return res.status(201).json(readSubscription(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Record<string, unknown>));
  try { return res.status(201).json(await refreshSubscription(id, req.user!.id)); }
  catch (error) { return res.status(201).json({ subscription: readSubscription(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(id) as Record<string, unknown>), error: error instanceof Error ? error.message : "更新失败" }); }
});

app.put("/api/projects/:projectId/subscriptions/:id", requireAuth, (req, res) => {
  const parsed = subscriptionSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "订阅名称、地址或更新间隔无效" });
  const result = db.prepare(`UPDATE subscriptions SET name = ?, url = ?, format = ?, interval_minutes = ?, updated_at = ?
    WHERE id = ? AND project_id = ? AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND user_id = ?)`)
    .run(parsed.data.name, parsed.data.url, parsed.data.format, parsed.data.intervalMinutes, new Date().toISOString(), req.params.id, req.params.projectId, req.params.projectId, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "订阅不存在" });
  res.json(readSubscription(db.prepare("SELECT * FROM subscriptions WHERE id = ?").get(req.params.id) as Record<string, unknown>));
});

app.post("/api/projects/:projectId/subscriptions/:id/update", requireAuth, async (req, res) => {
  try { res.json(await refreshSubscription(String(req.params.id), req.user!.id)); }
  catch (error) { res.status(422).json({ error: error instanceof Error ? error.message : "订阅更新失败" }); }
});

app.delete("/api/projects/:projectId/subscriptions/:id", requireAuth, (req, res) => {
  const project = db.prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?").get(req.params.projectId, req.user!.id) as Record<string, unknown> | undefined;
  if (!project) return res.status(404).json({ error: "项目不存在" });
  const subscription = db.prepare("SELECT id FROM subscriptions WHERE id = ? AND project_id = ?").get(req.params.id, req.params.projectId);
  if (!subscription) return res.status(404).json({ error: "订阅不存在" });
  if (req.query.removeNodes === "true") {
    const config = JSON.parse(String(project.config_json)) as MihomoConfig;
    snapshotProject(String(req.params.projectId), req.user!.id, "删除订阅前", true);
    config.proxies = config.proxies.filter((node) => node.source?.id !== req.params.id);
    db.prepare("UPDATE projects SET config_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(config), new Date().toISOString(), req.params.projectId);
  }
  const result = db.prepare("DELETE FROM subscriptions WHERE id = ? AND project_id = ?").run(req.params.id, req.params.projectId);
  if (!result.changes) return res.status(404).json({ error: "订阅不存在" });
  res.status(204).end();
});

app.get("/api/projects/:id/versions", requireAuth, (req, res) => {
  const rows = db.prepare(`SELECT project_versions.* FROM project_versions JOIN projects ON projects.id = project_versions.project_id
    WHERE project_versions.project_id = ? AND projects.user_id = ? ORDER BY project_versions.created_at DESC`).all(req.params.id, req.user!.id) as Record<string, unknown>[];
  res.json(rows.map((row) => ({ id: row.id, projectId: row.project_id, label: row.label, targetFormat: row.target_format, proxyCount: row.proxy_count, groupCount: row.group_count, ruleCount: row.rule_count, createdAt: row.created_at })));
});

app.post("/api/projects/:id/versions", requireAuth, (req, res) => {
  const label = typeof req.body?.label === "string" && req.body.label.trim() ? req.body.label.trim() : "手动快照";
  if (!snapshotProject(String(req.params.id), req.user!.id, label, true)) return res.status(404).json({ error: "项目不存在" });
  const row = db.prepare("SELECT * FROM project_versions WHERE project_id = ? ORDER BY created_at DESC LIMIT 1").get(req.params.id) as Record<string, unknown>;
  res.status(201).json({ id: row.id, projectId: row.project_id, label: row.label, targetFormat: row.target_format, proxyCount: row.proxy_count, groupCount: row.group_count, ruleCount: row.rule_count, createdAt: row.created_at });
});

app.post("/api/projects/:projectId/versions/:id/restore", requireAuth, (req, res) => {
  const version = db.prepare(`SELECT project_versions.* FROM project_versions JOIN projects ON projects.id = project_versions.project_id
    WHERE project_versions.id = ? AND project_versions.project_id = ? AND projects.user_id = ?`).get(req.params.id, req.params.projectId, req.user!.id) as Record<string, unknown> | undefined;
  if (!version) return res.status(404).json({ error: "历史版本不存在" });
  snapshotProject(String(req.params.projectId), req.user!.id, "恢复前备份", true);
  const now = new Date().toISOString();
  db.prepare("UPDATE projects SET config_json = ?, target_format = ?, updated_at = ? WHERE id = ?")
    .run(version.config_json, version.target_format, now, req.params.projectId);
  res.json(readProject(db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.projectId) as Record<string, unknown>));
});

app.post("/api/tools/parse", requireAuth, (req, res) => {
  const content = req.body?.content ?? req.body?.yaml;
  if (typeof content !== "string" || content.length > 2_000_000) return res.status(400).json({ error: "配置内容为空或超过 2MB" });
  try {
    const imported = parseImportedContent(content, (req.body.format || "auto") as ImportFormat);
    res.json({ ...imported, issues: imported.config ? validateConfig(imported.config) : [] });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "无法解析配置" });
  }
});

app.post("/api/tools/validate", requireAuth, (req, res) => res.json({ issues: validateConfig(req.body.config as MihomoConfig) }));
app.post("/api/tools/export", requireAuth, (req, res) => {
  const config = req.body.config as MihomoConfig;
  const issues = validateConfig(config);
  if (issues.some((issue) => issue.level === "error")) return res.status(422).json({ error: "请先修复配置错误", issues });
  if (req.body.format === "sing-box") return res.type("application/json").send(exportSingBoxJson(config));
  res.type("application/yaml").send(exportMihomoYaml(config));
});

const subscriptionTimer = setInterval(async () => {
  const rows = db.prepare(`SELECT subscriptions.id, projects.user_id, subscriptions.interval_minutes, subscriptions.last_updated_at
    FROM subscriptions JOIN projects ON projects.id = subscriptions.project_id WHERE subscriptions.interval_minutes > 0`).all() as { id: string; user_id: string; interval_minutes: number; last_updated_at?: string }[];
  for (const row of rows) {
    const due = !row.last_updated_at || Date.now() - new Date(row.last_updated_at).getTime() >= row.interval_minutes * 60_000;
    if (due) await refreshSubscription(row.id, row.user_id).catch((error) => console.error(`Subscription ${row.id}:`, error.message));
  }
}, 60_000);
subscriptionTimer.unref();

if (isProduction) {
  const dist = path.resolve("dist");
  app.use(express.static(dist, { maxAge: "1h", index: false }));
  app.get("/{*splat}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: "服务器内部错误" });
});

app.listen(port, "0.0.0.0", () => console.log(`OU-YAML API listening on http://0.0.0.0:${port}`));
