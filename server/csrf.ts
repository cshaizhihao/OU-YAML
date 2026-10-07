import type { NextFunction, Request, Response } from "express";

const mutationMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const sameSiteValues = new Set(["same-origin", "same-site", "none"]);

function normalizeOrigin(value: string | undefined) {
  if (!value) return undefined;
  try {
    const origin = new URL(value).origin;
    return origin === "null" ? undefined : origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function configuredOrigins() {
  return (process.env.APP_ORIGIN || "")
    .split(",")
    .map((value) => normalizeOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));
}

export function isAllowedMutationOrigin(req: Pick<Request, "method" | "path" | "get" | "protocol">) {
  if (!mutationMethods.has(req.method.toUpperCase()) || !req.path.startsWith("/api/")) return true;

  const originHeader = req.get("origin");
  if (!originHeader) {
    const fetchSite = req.get("sec-fetch-site")?.toLowerCase();
    return !fetchSite || sameSiteValues.has(fetchSite);
  }

  const origin = normalizeOrigin(originHeader);
  if (!origin) return false;
  const hostOrigin = normalizeOrigin(`${req.protocol}://${req.get("host")}`);
  return configuredOrigins().concat(hostOrigin ? [hostOrigin] : []).some((allowed) => allowed === origin);
}

export function csrfOriginGuard(req: Request, res: Response, next: NextFunction) {
  if (isAllowedMutationOrigin(req)) return next();
  return res.status(403).json({ error: "请求来源不受信任" });
}
