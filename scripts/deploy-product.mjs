/* global process, console */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = dirname(scriptDirectory);
const repository = "minhdoan3886/chatbot-stopirex";
const applicationId = 5;
const imageRepository = "2cenq94k4kvxfmlfgmkmjrbn";
const requiredChecks = ["verify", "integration", "scan"];
const productUrl = "https://ubuntu-latitude-e5450.tail0d12f7.ts.net";

function parseArguments(argv) {
  const options = {
    commit: undefined,
    force: false,
    dryRun: false,
    host: "stopirex-product",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--force") options.force = true;
    else if (argument === "--dry-run") options.dryRun = true;
    else if (argument === "--commit") {
      options.commit = argv[++index];
      if (!options.commit) throw new Error("--commit requires a value");
    } else if (argument === "--host") {
      options.host = argv[++index];
      if (!options.host) throw new Error("--host requires a value");
    } else if (argument === "--help") {
      console.log(
        "Usage: npm run deploy:product -- [--commit <origin/main SHA>] [--force] [--dry-run] [--host <ssh-alias>]",
      );
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[a-zA-Z0-9._-]+$/u.test(options.host ?? "")) throw new Error("Invalid SSH host");
  if (options.commit && !/^[0-9a-f]{40}$/u.test(options.commit)) throw new Error("Invalid commit SHA");
  return options;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  }).trim();
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function remote(host, ...args) {
  const command = args.map(shellQuote).join(" ");
  return run("ssh", ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", host, command]);
}

function parseJson(output, label) {
  const line = output
    .split("\n")
    .reverse()
    .find((candidate) => candidate.trim().startsWith("{"));
  if (!line) throw new Error(`${label} did not return JSON`);
  return JSON.parse(line);
}

function event(phase, detail = {}) {
  console.log(JSON.stringify({ phase, ...detail }));
}

function assertReleaseSource(requestedCommit) {
  if (run("git", ["status", "--porcelain"])) throw new Error("Working tree must be clean");
  if (run("git", ["branch", "--show-current"]) !== "main")
    throw new Error("Product releases must run from main");
  run("git", ["fetch", "--quiet", "origin", "main"]);
  const remoteMain = run("git", ["rev-parse", "origin/main"]);
  const localHead = run("git", ["rev-parse", "HEAD"]);
  const commit = requestedCommit ?? remoteMain;
  if (commit !== remoteMain) throw new Error("Requested commit is not the current origin/main");
  if (localHead !== remoteMain) throw new Error("Local main is not synchronized with origin/main");

  const checks = JSON.parse(
    run("gh", ["api", `repos/${repository}/commits/${commit}/check-runs`]),
  ).check_runs;
  const results = Object.fromEntries(checks.map((check) => [check.name, check]));
  for (const name of requiredChecks) {
    const check = results[name];
    if (!check || check.status !== "completed" || check.conclusion !== "success") {
      throw new Error(`Required GitHub check is not successful: ${name}`);
    }
  }
  return { commit, checks: requiredChecks };
}

function configureAndQueue(host, commit, force) {
  const deploymentCode = [
    `$app=\\App\\Models\\Application::findOrFail(${applicationId})`,
    "$app->health_check_enabled=true",
    '$app->health_check_path="/ready"',
    "$app->health_check_port=8080",
    '$app->health_check_host="localhost"',
    '$app->health_check_method="GET"',
    "$app->health_check_return_code=200",
    '$app->health_check_scheme="http"',
    "$app->health_check_interval=10",
    "$app->health_check_timeout=5",
    "$app->health_check_retries=6",
    "$app->health_check_start_period=20",
    "$app->save()",
    "$settings=$app->settings",
    "$settings->is_auto_deploy_enabled=false",
    "$settings->save()",
    "$uuid=(string)\\Illuminate\\Support\\Str::uuid()",
    `$result=queue_application_deployment($app,$uuid,0,"${commit}",${force ? "true" : "false"})`,
    'echo json_encode(["status"=>$result["status"],"deployment_uuid"=>$result["deployment_uuid"]??$uuid])',
  ].join("; ");
  return parseJson(
    remote(host, "docker", "exec", "coolify", "php", "artisan", "tinker", `--execute=${deploymentCode}`),
    "Coolify deployment",
  );
}

function deploymentSnapshot(host, deploymentUuid) {
  const snapshotCode = [
    `$queue=\\App\\Models\\ApplicationDeploymentQueue::where("deployment_uuid","${deploymentUuid}")->firstOrFail()`,
    'echo json_encode(["status"=>$queue->status,"finished_at"=>optional($queue->finished_at)->toIso8601String()])',
  ].join("; ");
  return parseJson(
    remote(host, "docker", "exec", "coolify", "php", "artisan", "tinker", `--execute=${snapshotCode}`),
    "Coolify status",
  );
}

function deploymentFailureLog(host, deploymentUuid) {
  const logCode = [
    `$queue=\\App\\Models\\ApplicationDeploymentQueue::where("deployment_uuid","${deploymentUuid}")->firstOrFail()`,
    "echo substr((string)$queue->logs,-6000)",
  ].join("; ");
  return remote(host, "docker", "exec", "coolify", "php", "artisan", "tinker", `--execute=${logCode}`);
}

async function waitForDeployment(host, deploymentUuid) {
  const deadline = Date.now() + 20 * 60 * 1000;
  let previousStatus;
  while (Date.now() < deadline) {
    const snapshot = deploymentSnapshot(host, deploymentUuid);
    if (snapshot.status !== previousStatus) event("coolify", snapshot);
    previousStatus = snapshot.status;
    if (snapshot.status === "finished") return snapshot;
    if (["failed", "cancelled", "cancelled-by-user"].includes(snapshot.status)) {
      console.error(deploymentFailureLog(host, deploymentUuid));
      throw new Error(`Coolify deployment ended with status ${snapshot.status}`);
    }
    await wait(5000);
  }
  throw new Error("Timed out while waiting for Coolify deployment");
}

async function findReadyApi(host, image) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const containers = remote(
      host,
      "docker",
      "ps",
      "--filter",
      `label=coolify.applicationId=${applicationId}`,
      "--format",
      "{{.Names}}|{{.Image}}",
    )
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
    const match = containers.find(([, candidateImage]) => candidateImage === image);
    if (match) {
      try {
        remote(host, "docker", "exec", match[0], "curl", "-fsS", "http://127.0.0.1:8080/ready");
        return match[0];
      } catch {
        // Coolify can mark its job finished just before the application is ready.
      }
    }
    await wait(3000);
  }
  throw new Error(`No ready product API found for ${image}`);
}

function copyReleaseTools(host) {
  run("scp", ["-q", join(scriptDirectory, "product-proxy.mjs"), `${host}:/tmp/stopirex-product-proxy.mjs`]);
  run("scp", [
    "-q",
    join(scriptDirectory, "roll-product-workers.sh"),
    `${host}:/tmp/stopirex-roll-product-workers.sh`,
  ]);
}

function finalizeRelease(host, commit, image, api) {
  event("proxy", { api });
  console.log(remote(host, "node", "/tmp/stopirex-product-proxy.mjs", "--apply", "--api-container", api));
  event("workers", { image });
  console.log(remote(host, "sh", "/tmp/stopirex-roll-product-workers.sh", image));

  const metadataCode = [
    `$app=\\App\\Models\\Application::findOrFail(${applicationId})`,
    `$app->git_commit_sha="${commit}"`,
    "$app->save()",
    "echo $app->fresh()->git_commit_sha",
  ].join("; ");
  const recordedCommit = remote(
    host,
    "docker",
    "exec",
    "coolify",
    "php",
    "artisan",
    "tinker",
    `--execute=${metadataCode}`,
  )
    .split("\n")
    .at(-1)
    ?.trim();
  if (recordedCommit !== commit) throw new Error("Coolify release metadata did not update");
}

function verifyRelease(host, commit, image, api) {
  const runtime = remote(
    host,
    "docker",
    "inspect",
    api,
    "stopirex-worker",
    "stopirex-followup-worker",
    "--format",
    "{{.Name}}|{{.Config.Image}}|{{.State.Running}}|{{.RestartCount}}",
  );
  for (const line of runtime.split("\n")) {
    const [, actualImage, running, restartCount] = line.split("|");
    if (actualImage !== image || running !== "true" || restartCount !== "0") {
      throw new Error(`Runtime verification failed: ${line}`);
    }
  }
  const ready = JSON.parse(run("curl", ["-fsS", "--max-time", "15", `${productUrl}/ready`]));
  if (ready.status !== "ready" || !ready.dependencies?.database || !ready.dependencies?.redis) {
    throw new Error("Public product readiness failed");
  }
  event("complete", { commit, image, api, productUrl, runtime: runtime.split("\n"), ready });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const source = assertReleaseSource(options.commit);
  const image = `${imageRepository}:${source.commit}`;
  event("preflight", {
    commit: source.commit,
    checks: source.checks,
    host: options.host,
    dryRun: options.dryRun,
  });
  remote(options.host, "docker", "info", "--format", "{{.ServerVersion}}");
  if (options.dryRun) {
    event("dry_run_complete", { commit: source.commit, image });
    return;
  }

  copyReleaseTools(options.host);
  const queued = configureAndQueue(options.host, source.commit, options.force);
  event("queued", queued);
  if (!queued.deployment_uuid || !["queued", "skipped"].includes(queued.status)) {
    throw new Error(`Coolify refused the deployment: ${queued.status ?? "unknown"}`);
  }
  await waitForDeployment(options.host, queued.deployment_uuid);
  const api = await findReadyApi(options.host, image);
  finalizeRelease(options.host, source.commit, image, api);
  verifyRelease(options.host, source.commit, image, api);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
