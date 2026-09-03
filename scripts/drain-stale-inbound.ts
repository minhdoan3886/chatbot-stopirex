import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { loadEnv } from "../src/config/env.js";

const env = loadEnv();
const apply = process.argv.includes("--apply");
const cutoffMinutes = parseCutoff(process.argv);

if (!env.databaseUrl) throw new Error("DATABASE_URL bắt buộc");
if (env.metaLiveSendEnabled) {
  throw new Error("safe_drain_requires_META_LIVE_SEND_ENABLED=false");
}

const pool = new Pool({ connectionString: env.databaseUrl });
const traceId = `safe-drain:${randomUUID()}`;
try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('safe-drain-inbound'))");
    const preview = await client.query(
      `SELECT count(*)::int AS count, min(received_at) AS oldest_at, max(received_at) AS newest_at
       FROM inbound_events
       WHERE processed_at IS NULL
         AND received_at < now() - ($1::int * interval '1 minute')`,
      [cutoffMinutes],
    );
    const count = Number(preview.rows[0]?.count ?? 0);
    if (!apply || count === 0) {
      await client.query("ROLLBACK");
      console.log(
        JSON.stringify({
          event: "safe_drain_preview",
          apply,
          count,
          cutoffMinutes,
          oldestAt: iso(preview.rows[0]?.oldest_at),
          newestAt: iso(preview.rows[0]?.newest_at),
        }),
      );
    } else {
      const drained = await client.query(
        `WITH updated AS (
           UPDATE inbound_events
           SET processed_at = now()
           WHERE processed_at IS NULL
             AND received_at < now() - ($1::int * interval '1 minute')
           RETURNING tenant_id, page_id, received_at
         ), audited AS (
           INSERT INTO audit_log (
             tenant_id, page_id, trace_id, actor_type, action, entity_type, metadata
           )
           SELECT tenant_id, page_id, $2, 'system', 'inbound.safe_drain', 'inbound_batch',
             jsonb_build_object(
               'count', count(*),
               'oldestAt', min(received_at),
               'newestAt', max(received_at),
               'cutoffMinutes', $1,
               'reason', 'stale_events_drained_with_live_send_disabled'
             )
           FROM updated
           GROUP BY tenant_id, page_id
           RETURNING id
         )
         SELECT count(*)::int AS count, min(received_at) AS oldest_at, max(received_at) AS newest_at
         FROM updated`,
        [cutoffMinutes, traceId],
      );
      await client.query("COMMIT");
      console.log(
        JSON.stringify({
          event: "safe_drain_applied",
          traceId,
          count: Number(drained.rows[0]?.count ?? 0),
          cutoffMinutes,
          oldestAt: iso(drained.rows[0]?.oldest_at),
          newestAt: iso(drained.rows[0]?.newest_at),
        }),
      );
    }
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}

function parseCutoff(argv: readonly string[]): number {
  const argument = argv.find((item) => item.startsWith("--cutoff-minutes="));
  const parsed = Number(argument?.split("=")[1] ?? "10");
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("--cutoff-minutes phải là số nguyên dương");
  }
  return parsed;
}

function iso(value: unknown): string | undefined {
  return value ? new Date(value as string | Date).toISOString() : undefined;
}
