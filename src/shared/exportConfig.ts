import { exportMihomoYaml, validateConfig } from "./mihomo";
import { exportSingBoxJson, singBoxCompatibility } from "./singbox";
import type { MihomoConfig, TargetFormat, ValidationIssue } from "./types";

export function previewExport(config: MihomoConfig, format: TargetFormat) {
  const issues: ValidationIssue[] = [...validateConfig(config), ...(format === "sing-box" ? singBoxCompatibility(config).map((message): ValidationIssue => ({ level: "error", scope: "config", message })) : [])];
  if (issues.some((issue) => issue.level === "error")) return { content: "", issues };
  try { return { content: format === "sing-box" ? exportSingBoxJson(config) : exportMihomoYaml(config), issues }; }
  catch (error) { return { content: "", issues: [...issues, { level: "error", scope: "config", message: (error as Error).message } as ValidationIssue] }; }
}
