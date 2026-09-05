import assert from "node:assert/strict";
import test from "node:test";
import { tenantId } from "../src/domain/types.js";
import { MetaPageCredentialVault } from "../src/services/metaPageCredential.js";
import { MetaPageManagementService } from "../src/services/metaPageManagement.js";

test("Page token được mã hóa và chỉ bật bot sau khi có credential", async () => {
  const vault = new MetaPageCredentialVault("test-secret");
  const encrypted = vault.encrypt("page-token");
  assert.notEqual(encrypted, "page-token");
  assert.equal(vault.decrypt(encrypted), "page-token");

  const pages: Array<Record<string, unknown>> = [];
  const service = new MetaPageManagementService({
    vault,
    graphVersion: "v25.0",
    store: {
      async listFacebookPages() {
        return pages as never;
      },
      async defaultFacebookTenantId() {
        return tenantId("tenant-1");
      },
      async upsertFacebookPageConnection(input) {
        pages.push({
          id: "internal-1",
          tenantId: input.tenantId,
          externalPageId: input.externalPageId,
          displayName: input.displayName,
          botEnabled: false,
          credentialConfigured: true,
          tokenUpdatedAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        });
        return "internal-1";
      },
      async setFacebookPageBotEnabled(input) {
        const page = pages.find((item) => item.id === input.pageId);
        if (!page) return false;
        page.botEnabled = input.enabled;
        return true;
      },
      async facebookPageCredential() {
        return undefined;
      },
      async storeFacebookPageCredential() {
        return true;
      },
    },
    fetcher: async (input, init) => {
      if (String(input).includes("/subscribed_apps")) {
        assert.match(String(init?.body), /feed/u);
        return Response.json({ success: true });
      }
      return Response.json({ id: "page-1", name: "Page Một" });
    },
  });

  const connected = await service.connectAuthorizedPages([
    { id: "page-1", name: "Page Một", accessToken: "page-token" },
  ]);
  assert.equal(connected[0]?.botEnabled, false);
  assert.equal(await service.setBotEnabled("internal-1", true), true);
});
