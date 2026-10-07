import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function key() {
  const filename = path.join(process.env.DATA_DIR || path.resolve("data"), "subscription.key");
  try { fs.writeFileSync(filename, randomBytes(32), { flag: "wx", mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  const value = fs.readFileSync(filename);
  if (value.length !== 32) throw new Error("订阅密钥文件无效");
  return value;
}

export function sealToken(token: string, resourceId: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(resourceId));
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString("base64");
}

export function openToken(value: string, resourceId: string) {
  const payload = Buffer.from(value, "base64");
  const cipher = createDecipheriv("aes-256-gcm", key(), payload.subarray(0, 12));
  cipher.setAAD(Buffer.from(resourceId));
  cipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([cipher.update(payload.subarray(28)), cipher.final()]).toString("utf8");
}
