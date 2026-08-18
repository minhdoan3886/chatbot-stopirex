import assert from "node:assert/strict";
import test from "node:test";
import { loadEnv } from "../src/config/env.js";
import { OperationsControlService } from "../src/services/operationsControl.js";

test("nút vận hành restart gateway và worker rồi kiểm tra các kết nối", async () => {
  const restarted: string[] = [];
  const startedAt = new Date("2026-08-13T00:00:00.000Z");
  const service = new OperationsControlService({
    env: loadEnv({
      NODE_ENV: "development",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
      META_TEST_PAGE_ID: "page-id",
      META_VERIFY_TOKEN: "verify-token",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    source: {
      OPENAI_API_KEY: "openai-key",
      OPENAI_MODEL: "gpt-test",
      CODEX_LLM_ENABLED: "true",
      CODEX_CLI_PATH: "/usr/local/bin/codex",
      CODEX_LLM_MODEL: "gpt-codex-test",
    },
    redis: {
      async getJson<T>() {
        return { at: "2026-08-13T00:00:01.000Z" } as T;
      },
    },
    processRuntime: {
      async restart(entrypoint) {
        restarted.push(entrypoint);
        return entrypoint.includes("worker") ? 202 : 101;
      },
      async run(executable, args) {
        assert.equal(executable, "/usr/local/bin/codex");
        assert.deepEqual(args, ["login", "status"]);
        return "Logged in using ChatGPT";
      },
    },
    async fetch(input) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return new Response("", { status: 403 });
      if (url.hostname === "bot.example.com") {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      if (url.hostname === "graph.facebook.com") {
        if (url.pathname.endsWith("/debug_token")) {
          return Response.json({ data: { app_id: "app-id", is_valid: true } });
        }
        if (url.pathname.endsWith("/page-id/subscribed_apps")) {
          return Response.json({
            data: [
              {
                id: "app-id",
                subscribed_fields: [
                  "messages",
                  "messaging_postbacks",
                  "message_deliveries",
                  "message_reads",
                  "message_echoes",
                ],
              },
            ],
          });
        }
        return Response.json({ id: "page-id", name: "Yến Nhi thích skincare" });
      }
      if (url.hostname === "api.openai.com") return Response.json({ id: "gpt-test" });
      return new Response("", { status: 404 });
    },
    now: () => startedAt,
    sleep: async () => undefined,
  });

  const result = await service.restartConnections();

  assert.equal(result.status, "healthy");
  assert.deepEqual(restarted, [
    "src/http/metaGateway.ts",
    "src/worker.ts",
    "src/followupWorker.ts",
  ]);
  assert.equal(result.steps.length, 7);
  assert.equal(result.steps.every((step) => step.status === "healthy"), true);
  assert.match(result.steps.find((step) => step.id === "meta-public-webhook")?.detail ?? "", /Challenge/u);
  assert.match(result.steps.find((step) => step.id === "meta-graph")?.detail ?? "", /Yến Nhi/u);
});

test("kết quả partial chỉ rõ OpenAI lỗi nhưng Codex vẫn hoạt động", async () => {
  const service = new OperationsControlService({
    env: loadEnv({
      NODE_ENV: "development",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
      META_VERIFY_TOKEN: "verify-token",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    source: {
      OPENAI_API_KEY: "bad-key",
      OPENAI_MODEL: "gpt-test",
      CODEX_LLM_ENABLED: "true",
    },
    redis: {
      async getJson<T>() {
        return { at: new Date(Date.now() + 60_000).toISOString() } as T;
      },
    },
    processRuntime: {
      async restart() {
        return 101;
      },
      async run() {
        return "Logged in using ChatGPT";
      },
    },
    async fetch(input) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return new Response("", { status: 403 });
      if (url.hostname === "bot.example.com") {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      if (url.hostname === "graph.facebook.com") return Response.json({ id: "page-id" });
      if (url.hostname === "api.openai.com") return new Response("", { status: 401 });
      return new Response("", { status: 404 });
    },
    sleep: async () => undefined,
  });

  const result = await service.restartConnections();

  assert.equal(result.status, "partial");
  assert.equal(result.steps.find((step) => step.id === "openai-llm")?.status, "down");
  assert.match(result.steps.find((step) => step.id === "openai-llm")?.detail ?? "", /không hợp lệ/u);
  assert.equal(result.steps.find((step) => step.id === "codex-cli")?.status, "healthy");
});

test("Public Webhook mất kết nối được tạo tunnel mới và cập nhật callback Meta", async () => {
  const runtimeValues: unknown[] = [];
  const env = loadEnv({
    NODE_ENV: "development",
    META_ACTIVE_PAGE: "test",
    META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
    META_TEST_PAGE_ID: "page-id",
    META_VERIFY_TOKEN: "verify-token",
    META_APP_SECRET: "app-secret",
    META_PUBLIC_WEBHOOK_URL: "https://old.example.com/webhooks/meta",
  });
  const service = new OperationsControlService({
    env,
    source: { META_APP_SECRET: "app-secret" },
    redis: {
      async getJson<T>(key: string) {
        if (key === "health:worker:meta") {
          return { at: new Date(Date.now() + 60_000).toISOString() } as T;
        }
        return undefined;
      },
      async setJson(_key, value) {
        runtimeValues.push(value);
      },
    },
    processRuntime: {
      async restart() {
        return 101;
      },
      async restartTunnel() {
        return { pid: 303, publicOrigin: "https://new.trycloudflare.com" };
      },
      async run() {
        return "";
      },
    },
    async fetch(input, init) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return new Response("", { status: 403 });
      if (url.hostname === "old.example.com") return new Response("", { status: 530 });
      if (url.hostname === "new.trycloudflare.com") {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      if (url.pathname.endsWith("/debug_token")) {
        return Response.json({ data: { app_id: "app-id", is_valid: true } });
      }
      if (url.pathname.endsWith("/app-id/subscriptions") && init?.method === "POST") {
        const body = new URLSearchParams(String(init.body));
        assert.equal(
          body.get("callback_url"),
          "https://new.trycloudflare.com/webhooks/meta",
        );
        return Response.json({ success: true });
      }
      if (url.pathname.endsWith("/page-id/subscribed_apps")) {
        return Response.json({
          data: [
            {
              id: "app-id",
              subscribed_fields: [
                "messages",
                "messaging_postbacks",
                "message_deliveries",
                "message_reads",
                "message_echoes",
              ],
            },
          ],
        });
      }
      if (url.pathname.endsWith("/me")) return Response.json({ id: "page-id" });
      return new Response("", { status: 404 });
    },
    sleep: async () => undefined,
  });

  const result = await service.restartConnections();
  const publicWebhook = result.steps.find((step) => step.id === "meta-public-webhook");

  assert.equal(publicWebhook?.status, "healthy");
  assert.equal(publicWebhook?.action, "restart");
  assert.match(publicWebhook?.detail ?? "", /tunnel mới/u);
  assert.equal(
    env.metaPublicWebhookUrl,
    "https://new.trycloudflare.com/webhooks/meta",
  );
  assert.equal(runtimeValues.length, 2);
  const stored = runtimeValues.find(
    (value) => typeof value === "object" && value !== null && "url" in value,
  ) as { url?: unknown; at?: unknown; pid?: unknown };
  assert.equal(stored.url, "https://new.trycloudflare.com/webhooks/meta");
  assert.equal(typeof stored.at, "string");
  assert.equal(stored.pid, 303);
});

test("Public Webhook báo down khi Page chưa subscribe app và token thiếu pages_manage_metadata", async () => {
  const cached: Array<{ key: string; value: unknown }> = [];
  const service = new OperationsControlService({
    env: loadEnv({
      NODE_ENV: "development",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
      META_TEST_PAGE_ID: "page-id",
      META_VERIFY_TOKEN: "verify-token",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    redis: {
      async getJson<T>(key: string) {
        if (key === "health:worker:meta" || key === "health:worker:followup") {
          return { at: new Date(Date.now() + 60_000).toISOString() } as T;
        }
        return undefined;
      },
      async setJson(key, value) {
        cached.push({ key, value });
      },
    },
    processRuntime: {
      async restart() {
        return 101;
      },
      async run() {
        return "";
      },
    },
    async fetch(input, init) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return new Response("", { status: 403 });
      if (url.hostname === "bot.example.com") {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      if (url.pathname.endsWith("/debug_token")) {
        return Response.json({ data: { app_id: "app-id", is_valid: true } });
      }
      if (url.pathname.endsWith("/page-id/subscribed_apps") && init?.method === "POST") {
        return Response.json(
          { error: { code: 200, message: "Requires pages_manage_metadata permission" } },
          { status: 403 },
        );
      }
      if (url.pathname.endsWith("/page-id/subscribed_apps")) {
        return Response.json(
          { error: { code: 200, message: "Requires pages_manage_metadata permission" } },
          { status: 403 },
        );
      }
      if (url.pathname.endsWith("/me")) return Response.json({ id: "page-id" });
      return new Response("", { status: 404 });
    },
    sleep: async () => undefined,
  });

  const result = await service.restartConnections();
  const publicWebhook = result.steps.find((step) => step.id === "meta-public-webhook");

  assert.equal(publicWebhook?.status, "down");
  assert.match(publicWebhook?.detail ?? "", /pages_manage_metadata/u);
  assert.ok(
    cached.some(
      (item) =>
        item.key === "health:meta:page-subscription" &&
        (item.value as { status?: unknown }).status === "down",
    ),
  );
});

test("Public Webhook không báo down khi Meta nhận subscribe nhưng token không đọc lại được", async () => {
  const cached: Array<{ key: string; value: unknown }> = [];
  const service = new OperationsControlService({
    env: loadEnv({
      NODE_ENV: "development",
      META_ACTIVE_PAGE: "test",
      META_TEST_PAGE_ACCESS_TOKEN: "meta-token",
      META_TEST_PAGE_ID: "page-id",
      META_VERIFY_TOKEN: "verify-token",
      META_PUBLIC_WEBHOOK_URL: "https://bot.example.com/webhooks/meta",
    }),
    redis: {
      async getJson<T>(key: string) {
        if (key === "health:worker:meta" || key === "health:worker:followup") {
          return { at: new Date(Date.now() + 60_000).toISOString() } as T;
        }
        return undefined;
      },
      async setJson(key, value) {
        cached.push({ key, value });
      },
    },
    processRuntime: {
      async restart() {
        return 101;
      },
      async run() {
        return "";
      },
    },
    async fetch(input, init) {
      const url = new URL(String(input));
      if (url.hostname === "127.0.0.1") return new Response("", { status: 403 });
      if (url.hostname === "bot.example.com") {
        return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 });
      }
      if (url.pathname.endsWith("/debug_token")) {
        return Response.json({ data: { app_id: "app-id", is_valid: true } });
      }
      if (url.pathname.endsWith("/page-id/subscribed_apps") && init?.method === "POST") {
        return Response.json({ success: true });
      }
      if (url.pathname.endsWith("/page-id/subscribed_apps")) {
        return Response.json(
          { error: { code: 200, message: "Requires pages_manage_metadata permission" } },
          { status: 403 },
        );
      }
      if (url.pathname.endsWith("/me")) return Response.json({ id: "page-id" });
      return new Response("", { status: 404 });
    },
    sleep: async () => undefined,
  });

  const result = await service.restartConnections();
  assert.equal(result.steps.find((step) => step.id === "meta-public-webhook")?.status, "healthy");
  assert.ok(
    cached.some(
      (item) =>
        item.key === "health:meta:page-subscription" &&
        (item.value as { status?: unknown }).status === "degraded",
    ),
  );
});
