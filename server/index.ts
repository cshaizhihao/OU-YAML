import express, { type NextFunction, type Request, type Response } from "express";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { db, ensureAdmin, hashToken, readProject } from "./db";
import { exportMihomoYaml, parseMihomoYaml, validateConfig } from "../src/shared/mihomo";
import { createEmptyConfig, type MihomoConfig } from "../src/shared/types";

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
  const now = new Date().toISOString();
  const result = db.prepare("UPDATE projects SET name = ?, config_json = ?, updated_at = ? WHERE id = ? AND user_id = ?")
    .run(name || "未命名配置", JSON.stringify(config), now, req.params.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "项目不存在" });
  res.json({ id: req.params.id, name: name || "未命名配置", updatedAt: now });
});

app.delete("/api/projects/:id", requireAuth, (req, res) => {
  const result = db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(req.params.id, req.user!.id);
  if (!result.changes) return res.status(404).json({ error: "项目不存在" });
  res.status(204).end();
});

app.post("/api/tools/parse", requireAuth, (req, res) => {
  if (typeof req.body?.yaml !== "string" || req.body.yaml.length > 2_000_000) return res.status(400).json({ error: "YAML 内容为空或超过 2MB" });
  try {
    const config = parseMihomoYaml(req.body.yaml);
    res.json({ config, issues: validateConfig(config) });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "无法解析 YAML" });
  }
});

app.post("/api/tools/validate", requireAuth, (req, res) => res.json({ issues: validateConfig(req.body.config as MihomoConfig) }));
app.post("/api/tools/export", requireAuth, (req, res) => {
  const config = req.body.config as MihomoConfig;
  const issues = validateConfig(config);
  if (issues.some((issue) => issue.level === "error")) return res.status(422).json({ error: "请先修复配置错误", issues });
  res.type("application/yaml").send(exportMihomoYaml(config));
});

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
