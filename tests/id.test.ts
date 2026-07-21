import assert from "node:assert/strict";
import { test } from "node:test";
import { createId } from "../src/shared/id";

test("不支持 randomUUID 的 HTTP 环境仍可生成 UUID", () => {
  let value = 0;
  const id = createId({ getRandomValues: (bytes) => { for (let index = 0; index < bytes.length; index++) bytes[index] = value++; return bytes; } });
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
