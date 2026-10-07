import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

for (const fail of [false, true]) test(fail ? "新版部署失败恢复旧提交与旧镜像" : "稳定版更新执行备份并切换固定提交", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ou-agent-test-"));
  const repo = path.join(directory, "repo");
  const bin = path.join(directory, "bin");
  const data = path.join(repo, "data");
  fs.mkdirSync(path.join(repo, "deploy"), { recursive: true });
  fs.mkdirSync(bin);
  fs.mkdirSync(data);
  const write = (filename: string, value: string) => fs.writeFileSync(filename, value, { mode: 0o755 });
  const git = (...args: string[]) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  try {
    for (const file of ["deploy/release.sh", "deploy/ou-yaml-web-update-agent.sh", "update.sh"]) write(path.join(repo, file), fs.readFileSync(file, "utf8"));
    write(path.join(repo, "backup.sh"), '#!/bin/sh\ntouch "$OU_YAML_DATA_DIR/backup-completed"\n');
    write(path.join(repo, ".gitignore"), ".env\ndata/\n");
    write(path.join(repo, ".env"), "OU_YAML_PORT=8787\n");
    write(path.join(repo, "package.json"), '{"version": "1.6.0"}\n');
    git("init", "-b", "main");
    git("config", "user.name", "OU Test");
    git("config", "user.email", "test@example.invalid");
    git("add", ".");
    git("commit", "-m", "old");
    const previous = git("rev-parse", "HEAD");
    write(path.join(repo, "package.json"), '{"version": "1.7.0"}\n');
    git("commit", "-am", "new");
    const target = git("rev-parse", "HEAD");
    git("tag", "v1.7.0");
    git("reset", "--hard", previous);
    git("remote", "add", "origin", repo);
    write(path.join(data, "web-update-request.json"), JSON.stringify({ channel: "stable", targetCommit: target }));
    write(path.join(bin, "curl"), '#!/bin/sh\nprintf \'{"tag_name":"v1.7.0"}\\n\'\n');
    write(path.join(bin, "chown"), "#!/bin/sh\nexit 0\n");
    write(path.join(bin, "install"), '#!/bin/bash\n/usr/bin/install -d -m 0750 "${@: -1}"\n');
    write(path.join(bin, "docker"), `#!/bin/bash
printf '%s\\n' "$*" >> "$TEST_COMMANDS"
case "$1 $2" in
  'inspect -f') if [[ "$3" == *Health* ]]; then echo healthy; else echo sha256:old; fi ;;
  'image inspect') echo "$TEST_TARGET" ;;
  'compose '*) if [[ "$*" == *' up '* ]] && [ "$TEST_FAIL" = yes ] && [ ! -f "$TEST_MARKER" ]; then touch "$TEST_MARKER"; exit 7; fi ;;
esac
`);
    const result = spawnSync("bash", [path.join(repo, "deploy/ou-yaml-web-update-agent.sh")], { cwd: repo, encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OU_YAML_INSTALL_DIR: repo, OU_YAML_DATA_DIR: data, OU_YAML_UPDATE_LOG: path.join(directory, "logs/update.log"), OU_YAML_UPDATE_LOCK: path.join(directory, "lock"), OU_YAML_UPDATE_MIN_FREE_KB: "0", TEST_TARGET: target, TEST_COMMANDS: path.join(directory, "commands"), TEST_FAIL: fail ? "yes" : "no", TEST_MARKER: path.join(directory, "failed-once") } });
    const status = JSON.parse(fs.readFileSync(path.join(data, "web-update-status.json"), "utf8"));
    assert.equal(status.status, fail ? "failed" : "completed", result.stderr);
    assert.equal(git("rev-parse", "HEAD"), fail ? previous : target);
    assert.equal(fs.existsSync(path.join(data, "backup-completed")), true);
    assert.equal(fs.existsSync(path.join(data, "web-update-request.json")), false);
    if (fail) {
      assert.match(status.message, /已自动恢复/);
      assert.match(fs.readFileSync(path.join(directory, "commands"), "utf8"), /tag sha256:old ou-yaml:local/);
    } else assert.equal(result.status, 0);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
