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
