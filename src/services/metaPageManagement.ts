import { GraphMetaMessenger } from "../adapters/metaMessenger.js";
import type { TenantId } from "../domain/types.js";
import type { MetaMessenger } from "../integrations/contracts.js";
import { MetaPageCredentialVault } from "./metaPageCredential.js";

export type ManagedMetaPage = {
  id: string;
  externalPageId: string;
  displayName: string;
  botEnabled: boolean;
  credentialConfigured: boolean;
  credentialSource: "database" | "environment" | "missing";
  tokenUpdatedAt?: string;
  updatedAt: string;
};

type MetaPageStore = {
  listFacebookPages(): Promise<
    Array<{
      id: string;
      tenantId: string;
      externalPageId: string;
      displayName: string;
      botEnabled: boolean;
      credentialConfigured: boolean;
      tokenUpdatedAt?: string;
      updatedAt: string;
    }>
  >;
  defaultFacebookTenantId(preferredExternalPageId?: string): Promise<TenantId | undefined>;
  upsertFacebookPageConnection(input: {
    tenantId: TenantId;
    externalPageId: string;
    displayName: string;
    encryptedAccessToken: string;
  }): Promise<string>;
  setFacebookPageBotEnabled(input: { pageId: string; enabled: boolean }): Promise<boolean>;
  facebookPageCredential(pageId: string): Promise<
    | {
        externalPageId: string;
        encryptedAccessToken?: string;
        botEnabled: boolean;
      }
    | undefined
  >;
  storeFacebookPageCredential(input: {
    externalPageId: string;
    displayName: string;
    encryptedAccessToken: string;
  }): Promise<boolean>;
};

const subscribedFields = [
  "feed",
  "message_deliveries",
  "message_echoes",
  "message_reads",
  "messages",
  "messaging_postbacks",
] as const;

export class MetaPageManagementService {
  private readonly cache = new Map<string, { token: string; messenger: MetaMessenger }>();

  constructor(
    private readonly options: {
      store: MetaPageStore;
      vault: MetaPageCredentialVault;
      graphVersion: string;
      environmentPageId?: string;
      environmentPageAccessToken?: string;
      fetcher?: typeof fetch;
    },
  ) {}

  async list(): Promise<ManagedMetaPage[]> {
    const pages = await this.options.store.listFacebookPages();
    return pages.map((page) => {
      const environmentCredential =
        page.externalPageId === this.options.environmentPageId &&
        Boolean(this.options.environmentPageAccessToken);
      return {
        id: page.id,
        externalPageId: page.externalPageId,
        displayName: page.displayName,
        botEnabled: page.botEnabled,
        credentialConfigured: page.credentialConfigured || environmentCredential,
        credentialSource: page.credentialConfigured
          ? "database"
          : environmentCredential
            ? "environment"
            : "missing",
        ...(page.tokenUpdatedAt ? { tokenUpdatedAt: page.tokenUpdatedAt } : {}),
        updatedAt: page.updatedAt,
      };
    });
  }

  async connect(pageAccessToken: string): Promise<ManagedMetaPage> {
    const profile = await this.readPageProfile(pageAccessToken);
    await this.subscribePage(profile.id, pageAccessToken);
    const tenantId = await this.options.store.defaultFacebookTenantId(this.options.environmentPageId);
    if (!tenantId) throw new Error("meta_tenant_not_configured");
    const id = await this.options.store.upsertFacebookPageConnection({
      tenantId,
      externalPageId: profile.id,
      displayName: profile.name,
      encryptedAccessToken: this.options.vault.encrypt(pageAccessToken),
    });
    this.cache.delete(id);
    const page = (await this.list()).find((item) => item.id === id);
    if (!page) throw new Error("meta_page_connection_not_found_after_save");
    return page;
  }

  async connectAuthorizedPages(
    pages: Array<{ id: string; name: string; accessToken: string }>,
  ): Promise<ManagedMetaPage[]> {
    const connected: ManagedMetaPage[] = [];
    for (const authorizedPage of pages) {
      const profile = await this.readPageProfile(authorizedPage.accessToken);
      if (profile.id !== authorizedPage.id) throw new Error("meta_oauth_page_token_mismatch");
      await this.subscribePage(profile.id, authorizedPage.accessToken);
      const tenantId = await this.options.store.defaultFacebookTenantId(this.options.environmentPageId);
      if (!tenantId) throw new Error("meta_tenant_not_configured");
      const id = await this.options.store.upsertFacebookPageConnection({
        tenantId,
        externalPageId: profile.id,
        displayName: profile.name || authorizedPage.name,
        encryptedAccessToken: this.options.vault.encrypt(authorizedPage.accessToken),
      });
      this.cache.delete(id);
      const page = (await this.list()).find((item) => item.id === id);
      if (!page) throw new Error("meta_page_connection_not_found_after_save");
      connected.push(page);
    }
    return connected;
  }

  async importEnvironmentCredential(): Promise<boolean> {
    const token = this.options.environmentPageAccessToken;
    const expectedPageId = this.options.environmentPageId;
    if (!token || !expectedPageId) return false;
    const existing = (await this.options.store.listFacebookPages()).find(
      (page) => page.externalPageId === expectedPageId,
    );
    if (existing?.credentialConfigured) return false;
    const profile = await this.readPageProfile(token);
    if (profile.id !== expectedPageId) throw new Error("environment_page_token_mismatch");
    return this.options.store.storeFacebookPageCredential({
      externalPageId: profile.id,
      displayName: profile.name,
      encryptedAccessToken: this.options.vault.encrypt(token),
    });
  }

  async setBotEnabled(pageId: string, enabled: boolean): Promise<boolean> {
    return this.options.store.setFacebookPageBotEnabled({ pageId, enabled });
  }

  async messengerForInternalPage(pageId: string): Promise<MetaMessenger> {
    return this.messengerForPage(pageId, true);
  }

  async messengerForManagement(pageId: string): Promise<MetaMessenger> {
    return this.messengerForPage(pageId, false);
  }

  private async messengerForPage(pageId: string, requireBotEnabled: boolean): Promise<MetaMessenger> {
    const page = await this.options.store.facebookPageCredential(pageId);
    if (!page) throw new Error("meta_page_not_found");
    if (requireBotEnabled && !page.botEnabled) throw new Error("meta_page_bot_disabled");
    const token = page.encryptedAccessToken
      ? this.options.vault.decrypt(page.encryptedAccessToken)
      : page.externalPageId === this.options.environmentPageId
        ? this.options.environmentPageAccessToken
        : undefined;
    if (!token) throw new Error("meta_page_credential_missing");
    const cached = this.cache.get(pageId);
    if (cached?.token === token) return cached.messenger;
    const messenger = new GraphMetaMessenger({
      pageAccessToken: token,
      graphVersion: this.options.graphVersion,
      ...(this.options.fetcher ? { fetcher: this.options.fetcher } : {}),
    });
    this.cache.set(pageId, { token, messenger });
    return messenger;
  }

  private async readPageProfile(pageAccessToken: string): Promise<{ id: string; name: string }> {
    const response = await (this.options.fetcher ?? fetch)(
      `https://graph.facebook.com/${this.options.graphVersion}/me?fields=id,name`,
      {
        headers: { authorization: `Bearer ${pageAccessToken}` },
        signal: AbortSignal.timeout(12_000),
      },
    );
    const payload = (await response.json()) as {
      id?: unknown;
      name?: unknown;
      error?: { message?: unknown };
    };
    if (!response.ok || typeof payload.id !== "string" || typeof payload.name !== "string") {
      throw new Error(
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `meta_page_token_invalid_http_${response.status}`,
      );
    }
    return { id: payload.id, name: payload.name };
  }

  private async subscribePage(pageId: string, pageAccessToken: string): Promise<void> {
    const body = new URLSearchParams({ subscribed_fields: subscribedFields.join(",") });
    const response = await (this.options.fetcher ?? fetch)(
      `https://graph.facebook.com/${this.options.graphVersion}/${encodeURIComponent(pageId)}/subscribed_apps`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${pageAccessToken}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body,
        signal: AbortSignal.timeout(12_000),
      },
    );
    const payload = (await response.json()) as { success?: unknown; error?: { message?: unknown } };
    if (!response.ok || payload.success !== true) {
      throw new Error(
        typeof payload.error?.message === "string"
          ? payload.error.message
          : `meta_page_subscribe_failed_http_${response.status}`,
      );
    }
  }
}
