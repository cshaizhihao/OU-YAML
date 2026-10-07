import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (file: string) => fs.readFileSync(file, "utf8");

test("Compose 按 IP 和域名模式隔离端口", () => {
  const base = read("docker-compose.yml");
  const ip = read("docker-compose.ip.yml");
  const caddy = read("docker-compose.caddy.yml");
  assert.doesNotMatch(base, /^\s+ports:/m);
  assert.match(ip, /\$\{OU_YAML_PORT:-8787\}:8787/);
  assert.match(caddy, /"80:80"/);
  assert.match(caddy, /"443:443"/);
  assert.doesNotMatch(caddy, /8787:8787/);
});

test("安装、更新和备份脚本使用正确的部署覆盖与 SQLite 排除规则", () => {
  const install = read("install.sh");
  const update = read("update.sh");
  const backup = read("backup.sh");
  for (const source of [install, update]) {
    assert.match(source, /docker-compose\.yml[^\n]+docker-compose\.ip\.yml/);
    assert.match(source, /docker-compose\.yml[^\n]+docker-compose\.caddy\.yml/);
  }
  assert.match(install, /OU_YAML_BUILD_COMMIT=.*git[^\n]+rev-parse HEAD/);
  assert.match(backup, /! -name 'ou-yaml\.db\*'/);
});

test("安装脚本展示正确品牌并支持管道命令的终端输入", () => {
  const install = read("install.sh");
  assert.match(install, /OOO\s+U\s+U[\s\S]+Y\s+Y\s+AAAAA\s+M\s+M\s+L/);
  assert.match(install, /作者：\$\{AUTHOR\}/);
  assert.match(install, /\/dev\/tty/);
  assert.match(install, /请输入[\s\S]*YES/);
  assert.match(install, /管理员账号需为 3-64 位/);
});

test("网页更新代理包含预检、健康检查与自动回滚", () => {
  const agent = read("deploy/ou-yaml-web-update-agent.sh");
  assert.match(agent, /available_kb/);
  assert.match(agent, /backup\.sh/);
  assert.match(agent, /wait_for_health/);
  assert.match(agent, /rollback_update/);
  assert.match(agent, /git[\s\S]+reset --hard/);
  assert.match(agent, /更新失败，已自动恢复更新前版本/);
});

test("生产静态目录和版本清单不依赖启动工作目录", () => {
  const server = read("server/index.ts");
  const update = read("server/update.ts");
  assert.match(server, /fileURLToPath\(import\.meta\.url\)/);
  assert.match(server, /sendFile\("index\.html", \{ root: dist \}\)/);
  assert.match(update, /fileURLToPath\(import\.meta\.url\)/);
  assert.doesNotMatch(update, /readFileSync\(path\.resolve\("package\.json"\)/);
});
