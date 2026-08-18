const target = process.env.LOAD_URL ?? "http://127.0.0.1:8080/health";
const total = Number(process.env.LOAD_REQUESTS ?? 200);
const concurrency = Number(process.env.LOAD_CONCURRENCY ?? 20);
const latencies: number[] = [];
let failures = 0;
let cursor = 0;

async function worker(): Promise<void> {
  while (cursor < total) {
    cursor += 1;
    const started = performance.now();
    try {
      const response = await fetch(target);
      if (!response.ok) failures += 1;
      await response.arrayBuffer();
    } catch {
      failures += 1;
    }
    latencies.push(performance.now() - started);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));
latencies.sort((a, b) => a - b);
const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0;
console.log(JSON.stringify({ target, total, concurrency, failures, p95Ms: Number(p95.toFixed(2)) }));
if (failures > 0 || p95 > Number(process.env.LOAD_P95_LIMIT_MS ?? 500)) process.exitCode = 1;
