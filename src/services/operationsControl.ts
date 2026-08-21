import { execFile, spawn } from "node:child_process";
import { Resolver } from "node:dns/promises";
import { mkdir, open, readFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import path from "node:path";
import type { AppEnv } from "../config/env.js";
import type { FollowupWorkerHeartbeat, WorkerHeartbeat } from "./operationsDashboard.js";

export type OperationsControlStep = {
  id: "meta-gateway" | "meta-worker" | "followup-worker" | "meta-public-webhook" | "meta-graph" | "openai-llm" | "codex-cli";
  name: string;
  action: "restart" | "check";
  status: "healthy" | "down" | "skipped";
  detail: string;
  latencyMs: number;
};

export type OperationsRestartResult = {
  startedAt: string;
  finishedAt: string;
  status: "healthy" | "partial";
  steps: OperationsControlStep[];
};

type ControlRedis = {
  getJson<T>(key: string): Promise<T | undefined>;
  setJson?(key: string, value: unknown, ttlSeconds: number): Promise<void>;
};

type PageSubscriptionHealth = {
  status: "healthy" | "degraded" | "down";
  at: string;
  pageId?: string;
  appId?: string;
  detail: string;
};

const requiredMetaWebhookFields = [
  "messages",
  "messaging_postbacks",
  "message_deliveries",
  "message_reads",
  "message_echoes",
] as const;

type ProcessRuntime = {
  restart(entrypoint: string, marker: string, logName: string): Promise<number>;
  restartTunnel?(
    executable: string,
    origin: string,
    logName: string,
  ): Promise<{ pid: number; publicOrigin: string }>;
  run(executable: string, args: string[], timeoutMs: number): Promise<string>;
};

type OperationsControlDependencies = {
  env: AppEnv;
  source?: NodeJS.ProcessEnv;
  redis?: ControlRedis;
  projectRoot?: string;
  processRuntime?: ProcessRuntime;
  fetch?: typeof fetch;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
};

export class OperationsControlBusyError extends Error {
  constructor() {
    super("operations_restart_in_progress");
    this.name = "OperationsControlBusyError";
  }
}

export class OperationsControlService {
  private restarting = false;
  private readonly source: NodeJS.ProcessEnv;
  private readonly projectRoot: string;
  private readonly runtime: ProcessRuntime;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly dependencies: OperationsControlDependencies) {
    this.source = dependencies.source ?? process.env;
    this.projectRoot = dependencies.projectRoot ?? process.cwd();
    this.runtime =
      dependencies.processRuntime ?? createLocalProcessRuntime(this.projectRoot);
    this.fetcher = dependencies.fetch ?? fetch;
    this.now = dependencies.now ?? (() => new Date());
    this.sleep = dependencies.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  }

  async restartConnections(): Promise<OperationsRestartResult> {
    if (this.restarting) throw new OperationsControlBusyError();
    this.restarting = true;
    const startedAt = this.now();
    const steps: OperationsControlStep[] = [];
    try {
      steps.push(await this.restartGateway());
      steps.push(await this.restartWorker(startedAt));
      steps.push(await this.restartFollowupWorker(startedAt));
      steps.push(
        ...(await Promise.all([
          this.ensurePublicWebhook(),
          this.checkMetaGraph(),
          this.checkOpenAi(),
          this.checkCodexCli(),
        ])),
      );
      return {
        startedAt: startedAt.toISOString(),
        finishedAt: this.now().toISOString(),
        status: steps.every((step) => step.status !== "down") ? "healthy" : "partial",
        steps,
      };
    } finally {
      this.restarting = false;
    }
  }

  private async restartGateway(): Promise<OperationsControlStep> {
    const started = performance.now();
    try {
      const pid = await this.runtime.restart(
        "src/http/metaGateway.ts",
        "src/http/metaGateway.ts",
        "meta-gateway.log",
      );
      const ready = await this.waitUntil(async () => {
        try {
          const response = await this.fetcher(
            `http://127.0.0.1:${this.dependencies.env.metaGatewayPort}/webhooks/meta`,
            { signal: AbortSignal.timeout(1_500) },
          );
          return response.ok || response.status === 403;
        } catch {
          return false;
        }
      });
      return step(
        "meta-gateway",
        "Meta Webhook Gateway",
        "restart",
        ready ? "healthy" : "down",
        ready ? `Đã khởi động lại · PID ${pid}` : "Tiến trình mới chưa phản hồi",
        started,
      );
    } catch (error) {
      return failedStep("meta-gateway", "Meta Webhook Gateway", "restart", error, started);
    }
  }

  private async restartWorker(startedAt: Date): Promise<OperationsControlStep> {
    const started = performance.now();
    if (!this.dependencies.redis) {
      return {
        id: "meta-worker",
        name: "Meta Worker",
        action: "restart",
        status: "skipped",
        detail: "Chưa cấu hình Redis để xác minh heartbeat",
        latencyMs: Math.round(performance.now() - started),
      };
    }
    try {
      const pid = await this.runtime.restart("src/worker.ts", "src/worker.ts", "meta-worker.log");
      const ready = await this.waitUntil(async () => {
        const heartbeat = await this.dependencies.redis?.getJson<WorkerHeartbeat>("health:worker:meta");
        return Boolean(heartbeat && new Date(heartbeat.at).getTime() >= startedAt.getTime());
      }, 12_000);
      return step(
        "meta-worker",
        "Meta Worker",
        "restart",
        ready ? "healthy" : "down",
        ready ? `Đã khởi động lại · PID ${pid}` : "Chưa nhận heartbeat mới sau khi khởi động",
        started,
      );
    } catch (error) {
      return failedStep("meta-worker", "Meta Worker", "restart", error, started);
    }
  }

  private async restartFollowupWorker(startedAt: Date): Promise<OperationsControlStep> {
    const started = performance.now();
    if (this.dependencies.env.followupMode === "disabled") {
      return skippedStep(
        "followup-worker",
        "Follow-up Worker",
        "FOLLOWUP_MODE đang disabled",
        started,
      );
    }
    if (!this.dependencies.redis) {
      return skippedStep(
        "followup-worker",
        "Follow-up Worker",
        "Chưa cấu hình Redis để xác minh heartbeat",
        started,
      );
    }
    try {
      const pid = await this.runtime.restart(
        "src/followupWorker.ts",
        "src/followupWorker.ts",
        "followup-worker.log",
      );
      const ready = await this.waitUntil(async () => {
        const heartbeat = await this.dependencies.redis?.getJson<FollowupWorkerHeartbeat>(
          "health:worker:followup",
        );
        return Boolean(heartbeat && new Date(heartbeat.at).getTime() >= startedAt.getTime());
      }, 12_000);
      return step(
        "followup-worker",
        "Follow-up Worker",
        "restart",
        ready ? "healthy" : "down",
        ready ? `Đã khởi động lại · PID ${pid}` : "Chưa nhận heartbeat follow-up mới",
        started,
      );
    } catch (error) {
      return failedStep("followup-worker", "Follow-up Worker", "restart", error, started);
    }
  }

  private async ensurePublicWebhook(): Promise<OperationsControlStep> {
    const started = performance.now();
    const runtimeWebhook = await this.dependencies.redis?.getJson<{ url?: unknown }>(
      "health:meta:public-webhook",
    );
    const url =
      typeof runtimeWebhook?.url === "string"
        ? runtimeWebhook.url
        : this.dependencies.env.metaPublicWebhookUrl;
    const token = this.dependencies.env.metaVerifyToken;
    if (!url || !token) {
      return skippedStep(
        "meta-public-webhook",
        "Meta Public Webhook",
        "Thiếu URL public hoặc verify token",
        started,
      );
    }
    try {
      const currentHealthy = await this.probeWebhookChallenge(url, token);
      if (currentHealthy) {
        await this.ensureActivePageSubscription();
        await this.dependencies.redis?.setJson?.(
          "health:meta:public-webhook",
          { url, at: this.now().toISOString() },
          60 * 60 * 24 * 30,
        );
        return step(
          "meta-public-webhook",
          "Meta Public Webhook",
          "check",
          "healthy",
          "Challenge HTTPS đi xuyên suốt thành công",
          started,
        );
      }
      if (!this.runtime.restartTunnel) {
        throw new Error("Cloudflare tunnel không hoạt động và runtime không hỗ trợ khởi động lại");
      }
      const tunnel = await this.runtime.restartTunnel(
        this.source.CLOUDFLARED_PATH?.trim() || "/opt/homebrew/bin/cloudflared",
        `http://127.0.0.1:${this.dependencies.env.metaGatewayPort}`,
        "cloudflared.log",
      );
      const newWebhookUrl = `${tunnel.publicOrigin.replace(/\/$/u, "")}/webhooks/meta`;
      const tunnelReady = await this.waitUntil(
        () => this.probeWebhookChallenge(newWebhookUrl, token),
        15_000,
      );
      if (!tunnelReady) throw new Error("Tunnel mới chưa vượt qua webhook challenge");
      await this.updateMetaCallbackWithRetry(newWebhookUrl);
      await this.ensureActivePageSubscription();
      this.dependencies.env.metaPublicWebhookUrl = newWebhookUrl;
      await this.dependencies.redis?.setJson?.(
        "health:meta:public-webhook",
        { url: newWebhookUrl, at: this.now().toISOString(), pid: tunnel.pid },
        60 * 60 * 24 * 30,
      );
      return step(
        "meta-public-webhook",
        "Meta Public Webhook",
        "restart",
        "healthy",
        `Đã tạo tunnel mới và cập nhật callback Meta · PID ${tunnel.pid}`,
        started,
      );
    } catch (error) {
      await this.storePageSubscriptionHealth({
        status: "down",
        detail: error instanceof Error ? error.message.slice(0, 220) : "unknown_error",
      });
      return failedStep("meta-public-webhook", "Meta Public Webhook", "check", error, started);
    }
  }

  private async ensureActivePageSubscription(): Promise<void> {
    const pageToken = this.dependencies.env.metaPageAccessToken;
    const pageId = this.dependencies.env.metaPageId;
    if (!pageToken || !pageId) {
      throw new Error("Thiếu Page ID hoặc Page Access Token để xác minh subscribed_apps");
    }

    const appId = await this.resolveMetaAppId(pageToken);
    const subscription = await this.readPageSubscription(pageId, pageToken, appId);
    if (!subscription.found || !subscription.hasAllRequiredFields) {
      const target = new URL(
        `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}/${pageId}/subscribed_apps`,
      );
      const form = new URLSearchParams({
        subscribed_fields: requiredMetaWebhookFields.join(","),
        access_token: pageToken,
      });
      const response = await this.fetcher(target, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await response.json().catch(() => ({}))) as {
        success?: unknown;
        error?: { code?: unknown; message?: unknown };
      };
      if (!response.ok || body.success !== true) {
        const missingPermission =
          body.error?.code === 200 ||
          (typeof body.error?.message === "string" && /pages_manage_metadata/iu.test(body.error.message));
        throw new Error(
          missingPermission
            ? "Trang chưa subscribe app; Page token thiếu quyền pages_manage_metadata"
            : `Không thể subscribe app vào Page · HTTP ${response.status}`,
        );
      }
      const verified = await this.readPageSubscription(pageId, pageToken, appId);
      if (verified.permissionDenied) {
        await this.storePageSubscriptionHealth({
          status: "degraded",
          pageId,
          appId,
          detail:
            "Meta đã nhận lệnh subscribe; token hiện tại không có quyền đọc lại subscribed_apps",
        });
        return;
      }
      if (!verified.found) throw new Error("Meta nhận lệnh subscribe nhưng chưa trả về app trên Page");
      if (!verified.hasAllRequiredFields) {
        throw new Error("Meta chưa đăng ký đủ message_echoes để phát hiện nhân viên tiếp quản");
      }
    }

    await this.storePageSubscriptionHealth({
      status: "healthy",
      pageId,
      appId,
      detail: "Page đã subscribe app nhận messages",
    });
  }

  private async resolveMetaAppId(pageToken: string): Promise<string> {
    const debugUrl = new URL(
      `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}/debug_token`,
    );
    debugUrl.searchParams.set("input_token", pageToken);
    debugUrl.searchParams.set("access_token", pageToken);
    const response = await this.fetcher(debugUrl, { signal: AbortSignal.timeout(10_000) });
    const body = (await response.json().catch(() => ({}))) as {
      data?: { app_id?: unknown; is_valid?: unknown };
    };
    if (
      !response.ok ||
      body.data?.is_valid !== true ||
      typeof body.data.app_id !== "string"
    ) {
      throw new Error("Không xác định được App ID từ Page token");
    }
    return body.data.app_id;
  }

  private async readPageSubscription(
    pageId: string,
    pageToken: string,
    appId: string,
  ): Promise<{ found: boolean; hasAllRequiredFields: boolean; permissionDenied?: boolean }> {
    const target = new URL(
      `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}/${pageId}/subscribed_apps`,
    );
    target.searchParams.set("access_token", pageToken);
    const response = await this.fetcher(target, { signal: AbortSignal.timeout(10_000) });
    const body = (await response.json().catch(() => ({}))) as {
      data?: Array<{ id?: unknown; subscribed_fields?: unknown }>;
      error?: { code?: unknown; message?: unknown };
    };
    if (!response.ok) {
      const missingPermission =
        body.error?.code === 200 ||
        (typeof body.error?.message === "string" && /pages_manage_metadata/iu.test(body.error.message));
      if (missingPermission) {
        return { found: false, hasAllRequiredFields: false, permissionDenied: true };
      }
      throw new Error(`Không đọc được subscribed_apps · HTTP ${response.status}`);
    }
    const app = body.data?.find((item) => item.id === appId);
    const subscribedFields = Array.isArray(app?.subscribed_fields)
      ? app.subscribed_fields.filter((field): field is string => typeof field === "string")
      : [];
    return {
      found: Boolean(app),
      hasAllRequiredFields: requiredMetaWebhookFields.every((field) =>
        subscribedFields.includes(field),
      ),
    };
  }

  private async storePageSubscriptionHealth(
    health: Omit<PageSubscriptionHealth, "at">,
  ): Promise<void> {
    await this.dependencies.redis?.setJson?.(
      "health:meta:page-subscription",
      { ...health, at: this.now().toISOString() },
      60 * 60 * 24 * 30,
    );
  }

  private async probeWebhookChallenge(url: string, token: string): Promise<boolean> {
    const challenge = `restart-${Date.now()}`;
    const target = new URL(url);
    target.searchParams.set("hub.mode", "subscribe");
    target.searchParams.set("hub.verify_token", token);
    target.searchParams.set("hub.challenge", challenge);
    try {
      const response = await this.fetcher(target, { signal: AbortSignal.timeout(8_000) });
      return response.ok && (await response.text()) === challenge;
    } catch {
      if (this.dependencies.fetch || !requiresPublicDnsProbe(target.hostname)) return false;
      return probeWebhookWithPublicDns(target, challenge);
    }
  }

  private async updateMetaCallback(callbackUrl: string): Promise<void> {
    const pageToken = this.dependencies.env.metaPageAccessToken;
    const appSecret = this.dependencies.env.metaAppSecret?.trim();
    const verifyToken = this.dependencies.env.metaVerifyToken;
    if (!pageToken || !appSecret || !verifyToken) {
      throw new Error("Thiếu Page token, App secret hoặc Verify token để cập nhật Meta callback");
    }
    const appId = await this.resolveMetaAppId(pageToken);
    const subscriptionUrl = new URL(
      `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}/${appId}/subscriptions`,
    );
    const form = new URLSearchParams({
      object: "page",
      fields: requiredMetaWebhookFields.join(","),
      callback_url: callbackUrl,
      verify_token: verifyToken,
      access_token: `${appId}|${appSecret}`,
    });
    const response = await this.fetcher(subscriptionUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await response.json().catch(() => ({}))) as { success?: unknown };
    if (!response.ok || body.success !== true) {
      throw new Error(`Meta không chấp nhận callback mới · HTTP ${response.status}`);
    }
  }

  private async updateMetaCallbackWithRetry(callbackUrl: string): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await this.updateMetaCallback(callbackUrl);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await this.sleep(attempt * 750);
      }
    }
    throw lastError;
  }

  private async checkMetaGraph(): Promise<OperationsControlStep> {
    const started = performance.now();
    const token = this.dependencies.env.metaPageAccessToken;
    if (!token) return skippedStep("meta-graph", "Meta Graph API", "Thiếu Page Access Token", started);
    try {
      const target = new URL(
        `https://graph.facebook.com/${this.dependencies.env.metaGraphVersion}/me`,
      );
      target.searchParams.set("fields", "id,name");
      target.searchParams.set("access_token", token);
      const response = await this.fetcher(target, { signal: AbortSignal.timeout(8_000) });
      const body = (await response.json().catch(() => ({}))) as { id?: unknown; name?: unknown };
      const ok = response.ok && typeof body.id === "string";
      return step(
        "meta-graph",
        "Meta Graph API",
        "check",
        ok ? "healthy" : "down",
        ok ? `Page token hợp lệ${typeof body.name === "string" ? ` · ${body.name}` : ""}` : `Meta từ chối · HTTP ${response.status}`,
        started,
      );
    } catch (error) {
      return failedStep("meta-graph", "Meta Graph API", "check", error, started);
    }
  }

  private async checkOpenAi(): Promise<OperationsControlStep> {
    const started = performance.now();
    const apiKey = this.source.OPENAI_API_KEY?.trim();
    const model = this.source.OPENAI_MODEL?.trim() || "gpt-5.4-nano";
    const baseUrl = (this.source.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1").replace(
      /\/+$/u,
      "",
    );
    if (!apiKey) return skippedStep("openai-llm", "OpenAI Responses API", "Chưa cấu hình API key", started);
    try {
      const response = await this.fetcher(
        `${baseUrl}/models/${encodeURIComponent(model)}`,
        {
          headers: { authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(8_000),
        },
      );
      return step(
        "openai-llm",
        "OpenAI Responses API",
        "check",
        response.ok ? "healthy" : "down",
        response.ok ? `API key có quyền dùng ${model}` : openAiFailureDetail(response.status, model),
        started,
      );
    } catch (error) {
      return failedStep("openai-llm", "OpenAI Responses API", "check", error, started);
    }
  }

  private async checkCodexCli(): Promise<OperationsControlStep> {
    const started = performance.now();
    if (this.source.CODEX_LLM_ENABLED !== "true") {
      return skippedStep("codex-cli", "Codex CLI", "CODEX_LLM_ENABLED đang tắt", started);
    }
    const executable = this.source.CODEX_CLI_PATH?.trim() || "codex";
    const model = this.source.CODEX_LLM_MODEL?.trim() || "mặc định";
    try {
      const stdout = await this.runtime.run(executable, ["login", "status"], 10_000);
      const ok = /logged in/iu.test(stdout);
      return step(
        "codex-cli",
        "Codex CLI",
        "check",
        ok ? "healthy" : "down",
        ok ? `Đăng nhập ChatGPT hợp lệ · model cấu hình ${model}` : "CLI chưa có phiên đăng nhập",
        started,
      );
    } catch (error) {
      return failedStep("codex-cli", "Codex CLI", "check", error, started);
    }
  }

  private async waitUntil(check: () => Promise<boolean>, timeoutMs = 8_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await check()) return true;
      await this.sleep(250);
    }
    return false;
  }
}

function requiresPublicDnsProbe(hostname: string): boolean {
  return hostname.endsWith(".trycloudflare.com") || hostname.endsWith(".ts.net");
}

async function probeWebhookWithPublicDns(
  target: URL,
  expectedChallenge: string,
): Promise<boolean> {
  try {
    const resolver = new Resolver();
    resolver.setServers(["1.1.1.1", "8.8.8.8"]);
    const addresses = await resolver.resolve4(target.hostname);
    const address = addresses[0];
    if (!address) return false;
    return await new Promise<boolean>((resolve) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: address,
          port: 443,
          path: `${target.pathname}${target.search}`,
          method: "GET",
          servername: target.hostname,
          headers: { host: target.host },
          timeout: 8_000,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer | string) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          });
          response.on("end", () => {
            resolve(
              response.statusCode !== undefined &&
                response.statusCode >= 200 &&
                response.statusCode < 300 &&
                Buffer.concat(chunks).toString("utf8") === expectedChallenge,
            );
          });
        },
      );
      request.on("timeout", () => request.destroy(new Error("public_dns_probe_timeout")));
      request.on("error", () => resolve(false));
      request.end();
    });
  } catch {
    return false;
  }
}

export function createLocalProcessRuntime(projectRoot: string): ProcessRuntime {
  return {
    async restart(entrypoint, marker, logName) {
      const processes = await listProcesses();
      const targets = processes.filter(
        (item) => item.pid !== process.pid && item.command.includes(marker),
      );
      for (const target of targets) process.kill(target.pid, "SIGTERM");
      const deadline = Date.now() + 4_000;
      for (const target of targets) {
        while (isProcessAlive(target.pid) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (isProcessAlive(target.pid)) process.kill(target.pid, "SIGKILL");
      }

      const logDirectory = path.join(projectRoot, "work", "runtime");
      await mkdir(logDirectory, { recursive: true });
      const log = await open(path.join(logDirectory, logName), "a");
      try {
        const child = spawn(
          process.execPath,
          ["--env-file-if-exists=.env", "--import", "tsx", entrypoint],
          {
            cwd: projectRoot,
            detached: true,
            env: process.env,
            stdio: ["ignore", log.fd, log.fd],
          },
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
        if (!child.pid) throw new Error("process_pid_missing");
        return child.pid;
      } finally {
        await log.close();
      }
    },
    async restartTunnel(executable, origin, logName) {
      await stopMatchingProcesses("cloudflared tunnel");
      const logDirectory = path.join(projectRoot, "work", "runtime");
      await mkdir(logDirectory, { recursive: true });
      const logPath = path.join(logDirectory, logName);
      const log = await open(logPath, "w");
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(
          executable,
          ["tunnel", "--no-autoupdate", "--protocol", "http2", "--url", origin],
          {
            cwd: projectRoot,
            detached: true,
            env: process.env,
            stdio: ["ignore", log.fd, log.fd],
          },
        );
        await new Promise<void>((resolve, reject) => {
          child.once("spawn", resolve);
          child.once("error", reject);
        });
        child.unref();
      } finally {
        await log.close();
      }
      if (!child.pid) throw new Error("cloudflared_pid_missing");
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const output = await readFile(logPath, "utf8").catch(() => "");
        const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/iu);
        if (match?.[0]) return { pid: child.pid, publicOrigin: match[0] };
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error("Không lấy được URL từ Cloudflare Quick Tunnel");
    },
    async run(executable, args, timeoutMs) {
      return new Promise((resolve, reject) => {
        execFile(executable, args, { timeout: timeoutMs, maxBuffer: 2_000_000 }, (error, stdout, stderr) => {
          if (error) reject(error);
          else resolve(`${stdout}\n${stderr}`);
        });
      });
    },
  };
}

async function stopMatchingProcesses(marker: string): Promise<void> {
  const processes = await listProcesses();
  const targets = processes.filter(
    (item) => item.pid !== process.pid && item.command.includes(marker),
  );
  for (const target of targets) {
    try {
      process.kill(target.pid, "SIGTERM");
    } catch {
      continue;
    }
  }
  const deadline = Date.now() + 4_000;
  for (const target of targets) {
    while (isProcessAlive(target.pid) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (isProcessAlive(target.pid)) process.kill(target.pid, "SIGKILL");
  }
}

async function listProcesses(): Promise<Array<{ pid: number; command: string }>> {
  const output = await new Promise<string>((resolve, reject) => {
    execFile("ps", ["-axo", "pid=,command="], { maxBuffer: 2_000_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim().match(/^(\d+)\s+(.+)$/u))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({ pid: Number(match[1]), command: match[2] ?? "" }));
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function step(
  id: OperationsControlStep["id"],
  name: string,
  action: OperationsControlStep["action"],
  status: OperationsControlStep["status"],
  detail: string,
  started: number,
): OperationsControlStep {
  return { id, name, action, status, detail, latencyMs: Math.round(performance.now() - started) };
}

function skippedStep(
  id: OperationsControlStep["id"],
  name: string,
  detail: string,
  started: number,
): OperationsControlStep {
  return step(id, name, "check", "skipped", detail, started);
}

function failedStep(
  id: OperationsControlStep["id"],
  name: string,
  action: OperationsControlStep["action"],
  error: unknown,
  started: number,
): OperationsControlStep {
  return step(
    id,
    name,
    action,
    "down",
    error instanceof Error ? error.message.slice(0, 220) : "unknown_error",
    started,
  );
}

function openAiFailureDetail(status: number, model: string): string {
  if (status === 401) return "API key không hợp lệ";
  if (status === 403) return `API key không có quyền dùng ${model}`;
  if (status === 404) return `Không tìm thấy hoặc chưa được cấp model ${model}`;
  if (status === 429) return "API key hết hạn mức hoặc đang bị giới hạn";
  return `OpenAI trả HTTP ${status}`;
}
