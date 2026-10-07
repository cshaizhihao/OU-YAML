import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import path from "node:path";

const helper = path.resolve("deploy/release.sh");

function deploy(pull: boolean, revision: string) {
  return execFileSync("bash", ["-c", `
    set -euo pipefail
    source "$HELPER"
    git() { printf '%s\\n' "$SHA"; }
    docker() {
      case "$1 $2" in
        'pull '*) test "$PULL" = yes ;;
        'image inspect') printf '%s\\n' "$REVISION" ;;
        'compose '*) printf '%s\\n' "$*" ;;
      esac
    }
    deploy_service -f docker-compose.yml -f docker-compose.ip.yml
  `], { env: { ...process.env, HELPER: helper, SHA: "a".repeat(40), REVISION: revision, PULL: pull ? "yes" : "no" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

test("预构建镜像固定 SHA，失败才回退源码构建", () => {
  assert.match(deploy(true, "a".repeat(40)), /--no-build --wait/);
  assert.match(deploy(false, ""), /--build --wait/);
  assert.throws(() => deploy(true, "b".repeat(40)), /镜像构建提交/);
});
