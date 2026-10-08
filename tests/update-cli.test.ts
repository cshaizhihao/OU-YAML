import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("CLI update exports its installation path and atomically refuses existing requests", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ou-cli-test-"));
  const repo = path.join(directory, "repo");
  const data = path.join(directory, "data");
  fs.mkdirSync(path.join(repo, "deploy"), { recursive: true });
  fs.mkdirSync(data);
  fs.copyFileSync("update.sh", path.join(repo, "update.sh"));
  fs.writeFileSync(path.join(repo, "deploy/ou-yaml-web-update-agent.sh"), 'printf "%s" "$OU_YAML_INSTALL_DIR"\n');
  const env: NodeJS.ProcessEnv = { ...process.env, OU_YAML_DATA_DIR: data, OU_YAML_SKIP_PULL: "0" };
  delete env.OU_YAML_INSTALL_DIR;
  try {
    const result = spawnSync("bash", [path.join(repo, "update.sh")], { env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, repo);
    const request = path.join(data, "web-update-request.json");
    assert.deepEqual(JSON.parse(fs.readFileSync(request, "utf8")), { channel: "stable" });
    assert.equal(fs.statSync(request).mode & 0o777, 0o600);
    const duplicate = spawnSync("bash", [path.join(repo, "update.sh")], { env, encoding: "utf8" });
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stdout, /已有更新任务/);
    assert.deepEqual(fs.readdirSync(data), ["web-update-request.json"]);
    fs.unlinkSync(request);
    const victim = path.join(directory, "preserve");
    fs.writeFileSync(victim, "unchanged");
    fs.symlinkSync(victim, request);
    assert.notEqual(spawnSync("bash", [path.join(repo, "update.sh")], { env }).status, 0);
    assert.equal(fs.readFileSync(victim, "utf8"), "unchanged");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
