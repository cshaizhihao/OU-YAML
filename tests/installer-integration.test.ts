import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(".");
const installer = path.join(root, "install.sh");
const isolated = process.getuid?.() === 0 && spawnSync("unshare", ["--mount", "--net", "--pid", "--fork", "true"]).status === 0;
const isolationOptions = { skip: isolated ? false : "Requires root and Linux mount/network/PID namespaces" };

function fixture(context: { after: (cleanup: () => void) => void }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ou-installer-e2e-"));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const repo = path.join(directory, "source");
  const bin = path.join(directory, "bin");
  const systemd = path.join(directory, "systemd");
  const logs = path.join(directory, "logs");
  for (const folder of [path.join(repo, "deploy"), bin, systemd, logs]) fs.mkdirSync(folder, { recursive: true });
  for (const filename of ["docker-compose.yml", "docker-compose.ip.yml", "docker-compose.caddy.yml", "Caddyfile", "backup.sh", "update.sh", "install-auto-update.sh", "deploy/release.sh", "deploy/ou-yaml-web-update-agent.sh", "deploy/ou-yaml-web-update-agent.service", "deploy/ou-yaml-web-update-agent.timer", "deploy/ou-yaml-update.service.in", "deploy/ou-yaml-update.timer"]) {
    fs.copyFileSync(path.join(root, filename), path.join(repo, filename));
    fs.chmodSync(path.join(repo, filename), fs.statSync(path.join(root, filename)).mode);
  }
  fs.writeFileSync(path.join(repo, "package.json"), '{"name":"ou-yaml","version":"1.9.0"}\n');
  const run = (command: string, args: string[]) => spawnSync(command, args, { cwd: repo, encoding: "utf8", stdio: "pipe" });
  assert.equal(run("git", ["init", "-b", "main"]).status, 0);
  run("git", ["config", "user.name", "OU installer test"]);
  run("git", ["config", "user.email", "installer@example.invalid"]);
  run("git", ["add", "."]);
  assert.equal(run("git", ["commit", "-m", "isolated installer fixture"]).status, 0);
  assert.equal(run("git", ["tag", "v1.9.0"]).status, 0);
  const write = (name: string, source: string) => fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${source}\n`, { mode: 0o755 });
  write("curl", 'printf \'{"tag_name":"v1.9.0"}\\n\'');
  write("ss", 'printf \'%s\\n\' "$*" >> "$SS_LOG"');
  write("systemctl", 'printf \'%s\\n\' "$*" >> "$SYSTEMCTL_LOG"; exit 0');
  write("docker", `printf '%s\\n' "$*" >> "$DOCKER_LOG"
case "$1 $2" in
  'compose version'|'info'|'ps --format') exit 0 ;;
  'inspect -f')
    if [ -f "$HEALTH_MARKER" ]; then echo healthy; else echo starting; fi
    ;;
  'pull '*) exit 1 ;;
  'compose '*)
    if [[ " $* " == *" ps -q "* ]]; then
      if [ -f "$HEALTH_MARKER" ]; then echo ou-yaml-container; fi
    elif [[ " $* " == *" up "* ]]; then
      if [ "$FAIL_FIRST_DEPLOY" = 1 ] && [ ! -e "$FAILED_DEPLOY_MARKER" ]; then touch "$FAILED_DEPLOY_MARKER"; exit 17; fi
      touch "$HEALTH_MARKER"
    fi
    ;;
esac`);
  return { directory, repo, bin, systemd, logs, write };
}

function execute(source: ReturnType<typeof fixture>, installDir: string, input: string, failFirstDeploy = false) {
  const isolationScript = path.join(source.directory, "isolate.sh");
  fs.writeFileSync(isolationScript, `set -euo pipefail
mount --make-rprivate /
mount --bind "$SYSTEMD_TEST_DIR" /etc/systemd/system
mount --bind "$LOG_TEST_DIR" /var/log
mount -t tmpfs tmpfs /run
cat "$INSTALLER_UNDER_TEST" | bash
`);
  return spawnSync("script", ["-qec", 'unshare --mount --net --pid --fork --kill-child --mount-proc bash "$ISOLATION_SCRIPT"', "/dev/null"], {
    input,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      ...process.env,
      TERM: "xterm",
      PATH: `${source.bin}:${process.env.PATH}`,
      ISOLATION_SCRIPT: isolationScript,
      INSTALLER_UNDER_TEST: installer,
      OU_YAML_REPO_URL: `file://${source.repo}`,
      OU_YAML_INSTALL_DIR: installDir,
      OU_YAML_UPDATE_CHANNEL: "stable",
      SYSTEMD_TEST_DIR: source.systemd,
      LOG_TEST_DIR: source.logs,
      DOCKER_LOG: path.join(source.directory, "docker.log"),
      SYSTEMCTL_LOG: path.join(source.directory, "systemctl.log"),
      SS_LOG: path.join(source.directory, "ss.log"),
      HEALTH_MARKER: path.join(source.directory, "healthy"),
      FAILED_DEPLOY_MARKER: path.join(source.directory, "deploy-failed"),
      FAIL_FIRST_DEPLOY: failFirstDeploy ? "1" : "0",
    },
  });
}

test("IP installation retries after a failed deploy and repeated runs stay idempotent", isolationOptions, (context) => {
  const source = fixture(context);
  const installDir = path.join(source.directory, "installed");
  const first = execute(source, installDir, "YES\n1\n1\n8787\nadmin-user\nlong-test-password\nn\n", true);
  assert.notEqual(first.status, 0, `${first.stderr}\n${first.stdout}`);
  assert.match(first.stdout + first.stderr, /OU-YAML 安装程序正在启动/);
  fs.mkdirSync(path.join(installDir, "data"), { recursive: true });
  fs.writeFileSync(path.join(installDir, "data", "keep.txt"), "persistent data\n");
  fs.writeFileSync(path.join(installDir, "data", "ou-yaml.db"), "database state\n");
  fs.rmSync(path.join(source.directory, "healthy"), { force: true });
  const retry = execute(source, installDir, "YES\n1\n");
  assert.equal(retry.status, 0, `${retry.stderr}\n${retry.stdout}`);
  assert.equal(fs.existsSync(path.join(installDir, ".env")), true);
  assert.equal(fs.readFileSync(path.join(installDir, ".env"), "utf8").includes("ADMIN_USERNAME=admin-user"), true);
  assert.equal(fs.existsSync(path.join(source.directory, "healthy")), true);
  const before = fs.readFileSync(path.join(source.directory, "docker.log"), "utf8");
  const rerun = execute(source, installDir, "YES\n1\n");
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(fs.readFileSync(path.join(source.directory, "docker.log"), "utf8").split("\n").filter((line) => line.includes("compose") && line.includes(" up ")).length, before.split("\n").filter((line) => line.includes("compose") && line.includes(" up ")).length);
  assert.equal(fs.readFileSync(path.join(installDir, "data", "keep.txt"), "utf8"), "persistent data\n");
});

for (const cfMode of ["1", "2"] as const) test(`域名模式 Cloudflare ${cfMode} 配置通过隔离部署`, isolationOptions, (context) => {
  const source = fixture(context);
  const installDir = path.join(source.directory, "installed");
  const result = execute(source, installDir, `YES\n1\n2\napp.example.com\n${cfMode}\nadmin-user\nlong-test-password\nn\n`);
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
  assert.match(result.stdout, /OOO\s+U\s+U[\s\S]+Y\s+Y\s+AAAAA/);
  assert.equal(fs.readFileSync(path.join(installDir, ".env"), "utf8").includes("APP_ORIGIN=https://app.example.com"), true);
  assert.match(fs.readFileSync(path.join(source.directory, "docker.log"), "utf8"), /docker-compose\.caddy\.yml up -d --build/);
  assert.match(fs.readFileSync(path.join(source.systemd, "ou-yaml-web-update-agent.service"), "utf8"), new RegExp(`Environment=OU_YAML_INSTALL_DIR=${installDir}`));
});
