import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const metaOAuthScopes = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "pages_manage_metadata",
] as const;

export type MetaOAuthPage = { id: string; name: string; accessToken: string; tasks: string[] };
type OAuthStatePayload = { nonce: string; issuedAt: number };

export class MetaOAuthService {
  constructor(
    private readonly options: {
      appId: string;
      appSecret: string;
      graphVersion: string;
      redirectUri: string;
      fetcher?: typeof fetch;
      now?: () => number;
    },
  ) {}

  begin(): { authorizationUrl: string; nonce: string; state: string } {
    const nonce = randomBytes(24).toString("base64url");
    const state = this.signState({ nonce, issuedAt: this.now() });
    const url = new URL(`https://www.facebook.com/${this.options.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", this.options.appId);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("state", state);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", metaOAuthScopes.join(","));
    return { authorizationUrl: url.toString(), nonce, state };
  }

  verifyState(state: string, cookieNonce: string): void {
    const parts = state.split(".");
    if (parts.length !== 2) throw new Error("meta_oauth_state_invalid");
    const [encodedPayload, encodedSignature] = parts as [string, string];
    const expected = this.signature(encodedPayload);
    let supplied: Buffer;
    try {
      supplied = Buffer.from(encodedSignature, "base64url");
    } catch {
      throw new Error("meta_oauth_state_invalid");
    }
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      throw new Error("meta_oauth_state_invalid");
    }
    let payload: OAuthStatePayload;
    try {
      payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as OAuthStatePayload;
    } catch {
      throw new Error("meta_oauth_state_invalid");
    }
    const age = this.now() - payload.issuedAt;
    if (
      typeof payload.nonce !== "string" ||
      payload.nonce.length < 20 ||
      !cookieNonce ||
      !safeEqualText(payload.nonce, cookieNonce) ||
      !Number.isFinite(age) ||
      age < 0 ||
      age > 600_000
    )
      throw new Error("meta_oauth_state_invalid");
  }

  async authorizedPages(code: string): Promise<MetaOAuthPage[]> {
    if (!code.trim()) throw new Error("meta_oauth_code_missing");
    const shortToken = await this.exchangeCode(code);
    const longToken = await this.exchangeLongLivedUserToken(shortToken);
    return this.listPages(longToken);
  }

  private signState(payload: OAuthStatePayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.signature(encoded).toString("base64url")}`;
  }
  private signature(value: string): Buffer {
    return createHmac("sha256", this.options.appSecret)
      .update(`${value}.${this.options.redirectUri}`, "utf8")
      .digest();
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private async exchangeCode(code: string): Promise<string> {
    const url = new URL(`https://graph.facebook.com/${this.options.graphVersion}/oauth/access_token`);
    url.searchParams.set("client_id", this.options.appId);
    url.searchParams.set("client_secret", this.options.appSecret);
    url.searchParams.set("redirect_uri", this.options.redirectUri);
    url.searchParams.set("code", code);
    return this.readAccessToken(url, "meta_oauth_code_exchange_failed");
  }
  private async exchangeLongLivedUserToken(token: string): Promise<string> {
    const url = new URL(`https://graph.facebook.com/${this.options.graphVersion}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", this.options.appId);
    url.searchParams.set("client_secret", this.options.appSecret);
    url.searchParams.set("fb_exchange_token", token);
    return this.readAccessToken(url, "meta_oauth_long_token_exchange_failed");
  }
  private async readAccessToken(url: URL, code: string): Promise<string> {
    const response = await (this.options.fetcher ?? fetch)(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(12_000),
    });
    const payload = (await response.json()) as { access_token?: unknown };
    if (!response.ok || typeof payload.access_token !== "string" || !payload.access_token)
      throw new Error(code);
    return payload.access_token;
  }
  private async listPages(userToken: string): Promise<MetaOAuthPage[]> {
    const pages: MetaOAuthPage[] = [];
    let next: URL | undefined = new URL(
      `https://graph.facebook.com/${this.options.graphVersion}/me/accounts`,
    );
    next.searchParams.set("fields", "id,name,access_token,tasks");
    next.searchParams.set("limit", "100");
    for (let pageCount = 0; next && pageCount < 10; pageCount += 1) {
      const response = await (this.options.fetcher ?? fetch)(next, {
        headers: { authorization: `Bearer ${userToken}`, accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      const payload = (await response.json()) as {
        data?: Array<{ id?: unknown; name?: unknown; access_token?: unknown; tasks?: unknown }>;
        paging?: { next?: unknown };
      };
      if (!response.ok || !Array.isArray(payload.data)) throw new Error("meta_oauth_pages_fetch_failed");
      for (const item of payload.data) {
        if (
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.access_token === "string"
        ) {
          pages.push({
            id: item.id,
            name: item.name,
            accessToken: item.access_token,
            tasks: Array.isArray(item.tasks)
              ? item.tasks.filter((task): task is string => typeof task === "string")
              : [],
          });
        }
      }
      next = safePagingUrl(payload.paging?.next);
    }
    return pages;
  }
}

function safePagingUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const url = new URL(value);
  return url.protocol === "https:" && url.hostname === "graph.facebook.com" ? url : undefined;
}
function safeEqualText(left: string, right: string): boolean {
  const first = Buffer.from(left, "utf8");
  const second = Buffer.from(right, "utf8");
  return first.length === second.length && timingSafeEqual(first, second);
}
