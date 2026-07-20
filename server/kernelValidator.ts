import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import { exportMihomoYaml } from "../src/shared/mihomo";
import { exportSingBoxJson } from "../src/shared/singbox";
import type { KernelInfo, KernelValidationResult, MihomoConfig, TargetFormat } from "../src/shared/types";

async function executable(candidates: (string | undefined)[]) {
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate)) continue;
    try { await fs.access(candidate, constants.X_OK); return candidate; } catch { /* Try the next fixed path. */ }
  }
  return undefined;
}

async function kernelBinary(format: TargetFormat) {
  return format === "sing-box"
    ? executable([process.env.SING_BOX_BINARY, "/usr/local/bin/sing-box", "/usr/bin/sing-box"])
    : executable([process.env.MIHOMO_BINARY, "/usr/local/bin/mihomo", "/usr/bin/mihomo"]);
}

function run(binary: string, args: string[], cwd: string) {
  return new Promise<{ valid: boolean; output: string }>((resolve) => {
    execFile(binary, args, { cwd, timeout: 15_000, maxBuffer: 2 * 1024 * 1024, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: cwd } }, (error, stdout, stderr) => {
      const output = `${stdout || ""}${stderr || ""}`.trim().slice(0, 20_000);
      resolve({ valid: !error, output: output || (error ? error.message : "配置检查通过") });
    });
  });
}

export async function validateWithKernel(config: MihomoConfig, format: TargetFormat): Promise<KernelValidationResult> {
  const isSingBox = format === "sing-box";
  const binary = await kernelBinary(format);
  if (!binary) return { available: false, engine: format, output: `未找到 ${isSingBox ? "sing-box" : "Mihomo"} 内核` };
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ou-yaml-check-"));
  const file = path.join(directory, isSingBox ? "config.json" : "config.yaml");
  try {
    await fs.writeFile(file, isSingBox ? exportSingBoxJson(config) : exportMihomoYaml(config), { mode: 0o600 });
    const result = await run(binary, isSingBox ? ["check", "-c", file, "-D", directory, "--disable-color"] : ["-t", "-d", directory, "-f", file], directory);
    return { available: true, valid: result.valid, engine: format, output: result.output };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}

export async function readKernelInfo(): Promise<KernelInfo[]> {
  const result: KernelInfo[] = [];
  for (const engine of ["mihomo", "sing-box"] as const) {
    const binary = await kernelBinary(engine);
    if (!binary) { result.push({ engine, available: false, version: "未安装" }); continue; }
    const version = await run(binary, engine === "sing-box" ? ["version"] : ["-v"], os.tmpdir());
    result.push({ engine, available: version.valid, version: version.output.split("\n")[0].slice(0, 160) || "已安装" });
  }
  return result;
}
