import { loadEnv } from "../src/config/env.js";
import { tenantId } from "../src/domain/types.js";
import { PostgresStore } from "../src/infrastructure/postgres.js";

const sandboxTenantId = tenantId("00000000-0000-0000-0000-000000000001");
const env = loadEnv();
if (!env.databaseUrl) throw new Error("DATABASE_URL bắt buộc");
if (!env.metaPageId) throw new Error("META_PAGE_ID bắt buộc");

const store = new PostgresStore(env.databaseUrl);
try {
  const pageId = await store.registerFacebookPage({
    tenantId: sandboxTenantId,
    externalPageId: env.metaPageId,
  });
  console.log(
    JSON.stringify({
      event: "meta_page_registered",
      activePage: env.metaActivePage,
      externalPageId: env.metaPageId,
      internalPageId: pageId,
      tenantId: sandboxTenantId,
    }),
  );
} finally {
  await store.close();
}
