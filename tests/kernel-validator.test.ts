import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import { validateWithKernel } from "../server/kernelValidator";
import { parseMihomoYaml } from "../src/shared/mihomo";

const config = parseMihomoYaml("proxies: []\nproxy-groups: []\nrules: []\n");
const directories: string[] = [];

afterEach(async () => {
  delete process.env.MIHOMO_BINARY;
  delete process.env.SING_BOX_BINARY;
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function fakeKernel(exitCode: number) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ou-yaml-fake-kernel-"));
  directories.push(directory);
  const file = path.join(directory, "kernel");
  await fs.writeFile(file, `#!/bin/sh\nprintf 'arguments:%s\\n' \"$*\"\nexit ${exitCode}\n`, { mode: 0o700 });
  return file;
}

test("Mihomo 内核通过时返回命令输出", async () => {
  process.env.MIHOMO_BINARY = await fakeKernel(0);
  const result = await validateWithKernel(config, "mihomo");
  assert.equal(result.available, true);
  assert.equal(result.valid, true);
  assert.match(result.output, /arguments:-t -d .* -f .*config\.yaml/);
});

test("sing-box 内核失败时返回失败状态", async () => {
  process.env.SING_BOX_BINARY = await fakeKernel(1);
  const result = await validateWithKernel(config, "sing-box");
  assert.equal(result.available, true);
  assert.equal(result.valid, false);
  assert.match(result.output, /arguments:check -c .*config\.json -D .* --disable-color/);
});

