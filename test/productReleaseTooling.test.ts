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
  assert.match(deploymentScript, /latestChecksByName/u);
  assert.match(deploymentScript, /check\.started_at/u);
  assert.match(deploymentScript, /results\.get\(name\)/u);
});

test("product release gate uses the newest result when a check name is repeated", () => {
  const source = deploymentScript.match(/function latestChecksByName\(checks\) \{[\s\S]*?\n\}/u)?.[0];
  assert.ok(source);
  const latestChecksByName = new Function(`${source}; return latestChecksByName;`)() as (
    checks: Array<{ id: number; name: string; started_at: string; conclusion: string }>,
  ) => Map<string, { conclusion: string }>;
  const newestFailure = {
    id: 20,
    name: "scan",
    started_at: "2026-09-14T07:28:44Z",
    conclusion: "failure",
  };
  const olderSuccess = {
    id: 10,
    name: "scan",
    started_at: "2026-09-14T06:27:27Z",
    conclusion: "success",
  };

  assert.equal(latestChecksByName([newestFailure, olderSuccess]).get("scan")?.conclusion, "failure");
  assert.equal(latestChecksByName([olderSuccess, newestFailure]).get("scan")?.conclusion, "failure");
});

test("worker rollout has an all-or-none rollback path", () => {
  execFileSync("sh", ["-n", "scripts/roll-product-workers.sh"]);
  assert.match(workerRollScript, /rollback\(\)/u);
  assert.match(workerRollScript, /stopirex-worker/u);
  assert.match(workerRollScript, /stopirex-followup-worker/u);
  assert.match(workerRollScript, /Invalid product API container/u);
  assert.match(workerRollScript, /docker inspect "\$api"/u);
  assert.match(workerRollScript, /env-file "\$runtime_env"/u);
  assert.match(workerRollScript, /cmp -s "\$expected_env" "\$worker_env"/u);
  assert.doesNotMatch(workerRollScript, /CURRENT\|\$worker/u);
  assert.doesNotMatch(workerRollScript, /docker inspect "\$worker" --format[^\n]+> "\$worker_env"/u);
  assert.match(workerRollScript, /docker rename "\$worker_backup" "\$worker"/u);
  assert.match(workerRollScript, /docker rename "\$followup_backup" "\$followup"/u);
});
