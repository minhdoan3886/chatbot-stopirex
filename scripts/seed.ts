import { readFile } from "node:fs/promises";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL bắt buộc");
const pool = new Pool({ connectionString: databaseUrl });
try {
  await pool.query(await readFile("migrations/seed_sandbox.sql", "utf8"));
  console.log(JSON.stringify({ event: "sandbox_seeded" }));
} finally {
  await pool.end();
}
