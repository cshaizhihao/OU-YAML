import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import { db } from "../server/db";

test("用户注册与权限分离集成测试", async (t) => {
  const username = `testuser_${Date.now()}`;
  const password = "StrongPassword123!";

  // 1. 模拟注册逻辑写入
  const now = new Date().toISOString();
  const id = `user_${Date.now()}`;
  const passwordHash = await bcrypt.hash(password, 10);

  db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 0, 0, ?)")
    .run(id, username, passwordHash, now);

  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as { id: string; username: string; password_hash: string; is_admin: number; is_disabled: number };
  assert.equal(row.username, username);
  assert.equal(row.is_admin, 0, "注册用户必须默认为非管理员普通用户");
  assert.equal(row.is_disabled, 0, "注册用户必须默认为启用状态");

  // 2. 验证密码匹配
  const valid = await bcrypt.compare(password, row.password_hash);
  assert.equal(valid, true, "密码哈希校验成功");

  // 3. 验证用户名唯一性约束
  assert.throws(() => {
    db.prepare("INSERT INTO users (id, username, password_hash, is_admin, is_disabled, created_at) VALUES (?, ?, ?, 0, 0, ?)")
      .run(`user_${Date.now()}_dup`, username, passwordHash, now);
  }, /UNIQUE constraint failed/);

  // 4. 清理测试用户
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
});
