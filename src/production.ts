import { spawn, type ChildProcess } from "node:child_process";

type ManagedProcess = {
  name: string;
  entrypoint: string;
  child?: ChildProcess;
};

const processes: ManagedProcess[] = [
  { name: "api", entrypoint: "dist/src/http/server.js" },
  { name: "meta-worker", entrypoint: "dist/src/worker.js" },
];

let shuttingDown = false;

function startProcess(processDefinition: ManagedProcess): ChildProcess {
  const child = spawn(process.execPath, [processDefinition.entrypoint], {
    env: process.env,
    stdio: "inherit",
  });
  processDefinition.child = child;
  child.once("error", (error) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "production_process_spawn_failed",
        process: processDefinition.name,
        reason: error.message,
      }),
    );
    void shutdown(1);
  });
  child.once("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      JSON.stringify({
        level: "error",
        event: "production_process_exited",
        process: processDefinition.name,
        code,
        signal,
      }),
    );
    void shutdown(code && code > 0 ? code : 1);
  });
  return child;
}

async function shutdown(exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const running = processes
    .map((processDefinition) => processDefinition.child)
    .filter((child): child is ChildProcess => Boolean(child && child.exitCode === null));
  for (const child of running) child.kill("SIGTERM");
  await Promise.race([
    Promise.all(running.map((child) => waitForExit(child))),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
  ]);
  for (const child of running) {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  process.exit(exitCode);
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));

for (const processDefinition of processes) startProcess(processDefinition);

console.log(
  JSON.stringify({
    level: "info",
    event: "production_processes_started",
    processes: processes.map((processDefinition) => processDefinition.name),
  }),
);
