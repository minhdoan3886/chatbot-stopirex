import assert from "node:assert/strict";
import test from "node:test";
import { tenantId } from "../src/domain/types.js";
import { MetaPageCredentialVault } from "../src/services/metaPageCredential.js";
import { MetaPageManagementService } from "../src/services/metaPageManagement.js";

test("mã hóa Page token có nonce riêng và giải mã đúng", () => {
  const vault = new MetaPageCredentialVault("test-encryption-key");
  const first = vault.encrypt("page-token-secret");
  const second = vault.encrypt("page-token-secret");
  assert.notEqual(first, second);
  assert.equal(vault.decrypt(first), "page-token-secret");
  assert.throws(() => vault.decrypt(`${first}x`));
});

test("liên kết Page xác minh token, subscribe webhook và mặc định tắt bot", async () => {
  const calls: Array<{ url: string; method: string; authorization?: string }> = [];
  const records: Array<{
    id: string;
    tenantId: string;
    externalPageId: string;
    displayName: string;
    botEnabled: boolean;
    credentialConfigured: boolean;
    updatedAt: string;
  }> = [];
  const encryptedByPage = new Map<string, string>();
  const store = {
    async listFacebookPages() {
      return records;
    },
    async defaultFacebookTenantId() {
      return tenantId("00000000-0000-0000-0000-000000000001");
    },
    async upsertFacebookPageConnection(input: {
      tenantId: string;
      externalPageId: string;
      displayName: string;
      encryptedAccessToken: string;
    }) {
      encryptedByPage.set(input.externalPageId, input.encryptedAccessToken);
      records.push({
        id: "00000000-0000-0000-0000-000000000011",
        tenantId: input.tenantId,
        externalPageId: input.externalPageId,
        displayName: input.displayName,
        botEnabled: false,
        credentialConfigured: true,
        updatedAt: new Date(0).toISOString(),
      });
      return records[0]!.id;
    },
    async setFacebookPageBotEnabled() {
      return true;
    },
    async facebookPageCredential() {
      return undefined;
    },
    async storeFacebookPageCredential() {
      return true;
    },
  };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      ...(typeof init?.headers === "object" && !Array.isArray(init.headers)
        ? { authorization: String((init.headers as Record<string, string>).authorization ?? "") }
        : {}),
    });
    return url.endsWith("/me?fields=id,name")
      ? new Response(JSON.stringify({ id: "669653209562535", name: "Yến Nhi thích skincare" }), {
          status: 200,
        })
      : new Response(JSON.stringify({ success: true }), { status: 200 });
  };
  const vault = new MetaPageCredentialVault("test-encryption-key");
  const service = new MetaPageManagementService({
    store,
    vault,
    graphVersion: "v26.0",
    fetcher,
  });

  const page = await service.connect("page-token-secret");

  assert.equal(page.displayName, "Yến Nhi thích skincare");
  assert.equal(page.botEnabled, false);
  assert.equal(page.credentialConfigured, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.authorization, "Bearer page-token-secret");
  assert.match(calls[1]!.url, /669653209562535\/subscribed_apps$/u);
  assert.equal(vault.decrypt(encryptedByPage.get("669653209562535")!), "page-token-secret");
});

test("router từ chối gửi khi Page đã tắt bot", async () => {
  const service = new MetaPageManagementService({
    store: {
      async listFacebookPages() {
        return [];
      },
      async defaultFacebookTenantId() {
        return undefined;
      },
      async upsertFacebookPageConnection() {
        return "unused";
      },
      async setFacebookPageBotEnabled() {
        return false;
      },
      async facebookPageCredential() {
        return { externalPageId: "page-1", botEnabled: false };
      },
      async storeFacebookPageCredential() {
        return false;
      },
    },
    vault: new MetaPageCredentialVault("test-encryption-key"),
    graphVersion: "v26.0",
  });
  await assert.rejects(() => service.messengerForInternalPage("page-internal"), /meta_page_bot_disabled/u);
});

test("quản trị comment vẫn dùng được khi bot Page đang tắt", async () => {
  const encrypted = new MetaPageCredentialVault("test-encryption-key").encrypt("page-token");
  const service = new MetaPageManagementService({
    store: {
      async listFacebookPages() {
        return [];
      },
      async defaultFacebookTenantId() {
        return undefined;
      },
      async upsertFacebookPageConnection() {
        return "unused";
      },
      async setFacebookPageBotEnabled() {
        return false;
      },
      async facebookPageCredential() {
        return { externalPageId: "page-1", encryptedAccessToken: encrypted, botEnabled: false };
      },
      async storeFacebookPageCredential() {
        return false;
      },
    },
    vault: new MetaPageCredentialVault("test-encryption-key"),
    graphVersion: "v26.0",
  });

  const messenger = await service.messengerForManagement("page-internal");
  assert.equal(typeof messenger.setCommentHidden, "function");
});
