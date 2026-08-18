import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL bắt buộc");
const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const files = (await readdir("migrations"))
    .filter((file) => /^\d{3}_.+\.sql$/u.test(file))
    .sort()
    .map((file) => `migrations/${file}`);
  for (const file of files) {
    const filename = file.split("/").at(-1)!;
    const applied = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE filename = $1",
      [filename],
    );
    if (applied.rowCount === 1) {
      console.log(JSON.stringify({ event: "migration_skipped", file }));
      continue;
    }
    if (await legacyMigrationAlreadyPresent(filename)) {
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [filename],
      );
      console.log(JSON.stringify({ event: "migration_baselined", file }));
      continue;
    }
    await pool.query(await readFile(file, "utf8"));
    await pool.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [filename],
    );
    console.log(JSON.stringify({ event: "migration_applied", file }));
  }
} finally {
  await pool.end();
}

async function legacyMigrationAlreadyPresent(filename: string): Promise<boolean> {
  const sentinel: Record<string, string> = {
    "001_init.sql": "SELECT to_regclass('public.tenants') IS NOT NULL AS present",
    "002_runtime.sql":
      "SELECT to_regclass('public.knowledge_versions') IS NOT NULL AS present",
    "003_conversation_quality.sql":
      "SELECT to_regclass('public.care_cases') IS NOT NULL AS present",
    "004_meta_runtime.sql": `
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'conversations'
          AND column_name = 'runtime_state'
      ) AS present
    `,
  };
  const query = sentinel[filename];
  if (!query) return false;
  const result = await pool.query(query);
  return result.rows[0]?.present === true;
}
