export function latencyLevel(value: number | null | undefined): "good" | "warn" | "bad" | "unknown" {
  if (value == null || !Number.isFinite(value) || value < 1 || value > 9999) return "unknown";
  if (value <= 50) return "good";
  if (value <= 160) return "warn";
  return "bad";
}
