import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const installer = path.resolve("install.sh");

const rootOptions = { skip: process.getuid?.() !== 0 ? "Installer requires root" : false };

test("piped installer reads YES and menu input from its controlling terminal", rootOptions, () => {
  const result = spawnSync("script", ["-qec", `cat '${installer}' | bash`, "/dev/null"], {
    input: "YES\n2\n",
    encoding: "utf8",
    timeout: 5000,
    env: { ...process.env, TERM: "xterm" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /使用协议/);
  assert.match(result.stdout, /主菜单/);
  assert.match(result.stdout, /OU-YAML 安装程序正在启动/);
});

test("installer rejects execution without a terminal", rootOptions, () => {
  const result = spawnSync("setsid", ["bash", installer], { input: "", encoding: "utf8", timeout: 3000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /需要交互式终端/);
});

test("curl piped through sudo preserves terminal agreement and exit menu", { skip: rootOptions.skip || spawnSync("sudo", ["-n", "true"]).status !== 0 }, () => {
  const result = spawnSync("script", ["-qec", `curl -fsSL '${pathToFileURL(installer).href}' | sudo -n bash`, "/dev/null"], {
    input: "YES\n2\n", encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /主菜单/);
  assert.match(result.stdout, /安装已退出/);
});

test("EOF at a menu prompt aborts instead of selecting the default", rootOptions, () => {
  const result = spawnSync("script", ["-qec", `cat '${installer}' | bash`, "/dev/null"], {
    input: "YES\n\x04", encoding: "utf8", timeout: 5000,
  });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /终端输入已关闭/);
  assert.doesNotMatch(result.stdout, /正在下载/);
});

for (const mode of ["ip", "domain"] as const) test(`${mode} installer refuses an occupied published port without stopping services`, rootOptions, () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ou-install-check-"));
  const bin = path.join(directory, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "ss"), "#!/bin/sh\necho 'LISTEN 0 10 0.0.0.0:80 0.0.0.0:*'\n", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "docker"), "#!/bin/sh\nif [ \"$1\" = ps ]; then echo '0.0.0.0:8787->8787/tcp'; exit 0; fi\nexit 0\n", { mode: 0o755 });
  const input = mode === "ip" ? "YES\n1\n1\n8787\n" : "YES\n1\n2\nexample.com\n1\n";
  try {
    const result = spawnSync("script", ["-qec", `env PATH='${bin}:${process.env.PATH}' OU_YAML_INSTALL_DIR='${directory}/install' bash '${installer}'`, "/dev/null"], {
      input,
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, TERM: "xterm" },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stdout + result.stderr, /端口已被占用/);
    assert.doesNotMatch(fs.readdirSync(directory).join(" "), /install/);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
