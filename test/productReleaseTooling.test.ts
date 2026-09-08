import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const deploymentScript = readFileSync(new URL("../scripts/deploy-product.mjs", import.meta.url), "utf8");
const workerRollScript = readFileSync(new URL("../scripts/roll-product-workers.sh", import.meta.url), "utf8");

test("product release command exposes help without contacting product", () => {
  const output = execFileSync(process.execPath, ["scripts/deploy-product.mjs", "--help"], {
    encoding: "utf8",
  });
  assert.match(output, /npm run deploy:product/u);
});

test("product release is gated and keeps every runtime on one image", () => {
  for (const check of ["verify", "integration", "scan"]) {
    assert.match(deploymentScript, new RegExp(`"${check}"`, "u"));
  }
  assert.match(deploymentScript, /Requested commit is not the current origin\/main/u);
  assert.match(deploymentScript, /health_check_path="\/ready"/u);
  assert.match(deploymentScript, /is_auto_deploy_enabled=false/u);
  assert.match(deploymentScript, /roll-product-workers\.sh/u);
  assert.match(deploymentScript, /product-proxy\.mjs/u);
});

test("worker rollout has an all-or-none rollback path", () => {
  execFileSync("sh", ["-n", "scripts/roll-product-workers.sh"]);
  assert.match(workerRollScript, /rollback\(\)/u);
  assert.match(workerRollScript, /stopirex-worker/u);
  assert.match(workerRollScript, /stopirex-followup-worker/u);
  assert.match(workerRollScript, /docker rename "\$worker_backup" "\$worker"/u);
  assert.match(workerRollScript, /docker rename "\$followup_backup" "\$followup"/u);
});
