import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

for (const scenario of ["success", "deploy-failure", "rollback-failure"] as const) test(scenario === "success" ? "稳定版更新备份数据后健康部署固定提交" : scenario === "deploy-failure" ? "新版失败时恢复旧提交、镜像和数据库" : "旧版恢复失败时明确报告未完成回滚", () => {
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
    for (const file of ["deploy/release.sh", "deploy/ou-yaml-web-update-agent.sh", "update.sh", "backup.sh"]) write(path.join(repo, file), fs.readFileSync(file, "utf8"));
    write(path.join(repo, ".gitignore"), ".env\ndata/\n");
    write(path.join(repo, ".env"), "OU_YAML_PORT=8787\n");
    write(path.join(data, "ou-yaml.db"), "before update\n");
    write(path.join(data, "user-data.json"), "preserve me\n");
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
args=("$@")
if [ "\${args[0]}" = inspect ]; then
  if [[ "\${args[2]}" == *Health* ]]; then echo healthy; else cat "$TEST_IMAGE"; fi
elif [ "\${args[0]}" = image ]; then
  if [[ "\${args[3]}" == *Id* ]]; then echo "$TEST_NEW_IMAGE"; else echo "$TEST_TARGET"; fi
elif [ "\${args[0]}" = compose ]; then
  if [ "\${args[1]}" = version ]; then exit 0; fi
  index=1
  while [ "\${args[index]:-}" = -f ]; do index=$((index + 2)); done
  command="\${args[index]:-}"
  following="\${args[index + 1]:-}"
  if [ "$command" = ps ]; then
    if [ "$following" != --status ]; then echo app-container; fi
  elif [ "$command" = stop ] && [ "$TEST_SCENARIO" = rollback-failure ] && [ -f "$TEST_MARKER" ]; then
    exit 8
  elif [ "$command" = up ]; then
    if [ "\${OU_YAML_IMAGE:-}" != ou-yaml:rollback ]; then
      if [ "$TEST_SCENARIO" != success ] && [ ! -f "$TEST_MARKER" ]; then
        touch "$TEST_MARKER"
        echo after-update > "$TEST_DATA/ou-yaml.db"
        exit 7
      fi
      echo "$TEST_NEW_IMAGE" > "$TEST_IMAGE"
      echo after-update > "$TEST_DATA/ou-yaml.db"
    else
      if [ "$TEST_SCENARIO" = rollback-failure ]; then exit 9; fi
      echo "$TEST_OLD_IMAGE" > "$TEST_IMAGE"
    fi
  fi
fi
`);
    const image = path.join(directory, "image");
    const oldImage = `sha256:${"a".repeat(64)}`;
    const nextImage = `sha256:${"b".repeat(64)}`;
    fs.writeFileSync(image, `${oldImage}\n`);
    write(path.join(bin, "sqlite3"), "#!/bin/bash\nbackup_target=\${2#*.backup }\nbackup_target=\${backup_target#\\'}\nbackup_target=\${backup_target%\\'}\ncp \"$1\" \"$backup_target\"\n");
    const result = spawnSync("bash", [path.join(repo, "deploy/ou-yaml-web-update-agent.sh")], { cwd: repo, encoding: "utf8", timeout: 15_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, OU_YAML_INSTALL_DIR: repo, OU_YAML_DATA_DIR: data, OU_YAML_UPDATE_LOG: path.join(directory, "logs/update.log"), OU_YAML_UPDATE_LOCK: path.join(directory, "lock"), OU_YAML_BACKUP_LOCK: path.join(directory, "backup-lock"), OU_YAML_UPDATE_MIN_FREE_KB: "0", TEST_TARGET: target, TEST_OLD_IMAGE: oldImage, TEST_NEW_IMAGE: nextImage, TEST_IMAGE: image, TEST_DATA: data, TEST_COMMANDS: path.join(directory, "commands"), TEST_SCENARIO: scenario, TEST_MARKER: path.join(directory, "failed-once") } });
    const status = JSON.parse(fs.readFileSync(path.join(data, "web-update-status.json"), "utf8"));
    assert.equal(status.status, scenario === "success" ? "completed" : "failed", `${result.stderr}\n${fs.readFileSync(path.join(directory, "logs/update.log"), "utf8")}\n${fs.readFileSync(path.join(directory, "commands"), "utf8")}`);
    assert.equal(git("rev-parse", "HEAD"), scenario === "success" ? target : previous);
    assert.equal(fs.existsSync(path.join(data, "web-update-request.json")), false);
    assert.equal(fs.readFileSync(path.join(data, "user-data.json"), "utf8"), "preserve me\n");
    assert.equal(fs.readFileSync(path.join(data, "ou-yaml.db"), "utf8"), scenario === "deploy-failure" ? "before update\n" : "after-update\n");
    if (scenario === "success") assert.equal(result.status, 0);
    else if (scenario === "deploy-failure") assert.match(status.message, /已自动恢复/);
    else assert.match(status.message, /均未通过健康检查/);
    const backupRoot = path.join(repo, "backups");
    assert.ok(fs.readdirSync(backupRoot).some((name) => name.startsWith("update.")));
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
