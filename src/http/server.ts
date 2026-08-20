import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { loadEnv } from "../config/env.js";
import { verifyMetaChallenge, verifyMetaSignature } from "../adapters/metaWebhook.js";
import { isBotAuthoredEcho, parseMetaWebhook } from "../adapters/metaEvents.js";
import { PostgresStore } from "../infrastructure/postgres.js";
import { RedisRuntime } from "../infrastructure/redis.js";
import { StructuredLogger } from "../services/logger.js";
import {
  DemoChatService,
  isCompoundOrderUpdateQuestion,
  isDomesticDeliveryEtaQuestion,
  isInternalSystemProbe,
  isInternationalShippingQuestion,
  isLikelyAdministrativeFragment,
  isOutOfScopeAssistantProbe,
  isOrderCaptureMessage,
  isPriceAndShippingPolicyQuestion,
  isWholesaleDealerInquiry,
  isPriceConcern,
  isQuantityShippingPolicyQuestion,
  type DemoChatResponse,
  type DemoChatState,
} from "../services/demoChat.js";
import {
  CodexLlmBridge,
  repairMissingKnowledgeCitations,
  requiresKnowledgeGrounding,
  type CodexInterpretResult,
  type ApprovedKnowledgeContext,
} from "../services/codexLlm.js";
import { retrieveKnowledge } from "../domain/knowledge.js";
import { stopirexApprovedKnowledge } from "../domain/stopirexKnowledge.js";
import { tenantId } from "../domain/types.js";
import { openingVariants, type ConversationIdentity, type OpeningVariantId } from "../domain/sales.js";
import { governCustomerResponse } from "../domain/responseGovernor.js";
import { evaluateConversationQuality } from "../domain/conversationQuality.js";
import { OperationsDashboardService } from "../services/operationsDashboard.js";
import { OperationsControlBusyError, OperationsControlService } from "../services/operationsControl.js";
import { buildProductInformationSnapshot } from "../services/productInformation.js";
import { operationsPage } from "./operationsPage.js";
import { productPage } from "./productPage.js";
import { ordersPage } from "./ordersPage.js";
import { OrderInboxService } from "../services/orderInbox.js";

const env = loadEnv();
const logger = new StructuredLogger();
const postgres = env.databaseUrl ? new PostgresStore(env.databaseUrl) : undefined;
const redis = env.redisUrl ? new RedisRuntime(env.redisUrl) : undefined;
const demoChat = new DemoChatService();
const codexLlm = CodexLlmBridge.fromEnvironment(
  process.env,
  postgres ? (event) => postgres.recordLlmUsage(event) : undefined,
);
const knowledgeTenantId = tenantId("stopirex-demo");
const approvedKnowledge = stopirexApprovedKnowledge(knowledgeTenantId);
const operationsDashboard = new OperationsDashboardService({
  env,
  ...(postgres ? { database: postgres } : {}),
  ...(redis ? { redis } : {}),
  llm: codexLlm,
});
const operationsControl = new OperationsControlService({
  env,
  ...(redis ? { redis } : {}),
});
const orderInbox = postgres ? new OrderInboxService(postgres.pool) : undefined;

const server = createServer(async (request, response) => {
  const traceId = String(request.headers["x-request-id"] ?? randomUUID());
  response.setHeader("x-request-id", traceId);
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/") {
    return html(response, 200, demoPage);
  }

  if (request.method === "GET" && url.pathname === "/operations") {
    return html(response, 200, operationsPage);
  }

  if (request.method === "GET" && url.pathname === "/product") {
    return html(response, 200, productPage);
  }

  if (request.method === "GET" && url.pathname === "/orders") {
    if (!isOperationsAuthorized(request)) {
      response.setHeader("WWW-Authenticate", 'Basic realm="Stopirex operations"');
      return json(response, 401, { error: "unauthorized" });
    }
    return html(response, 200, ordersPage);
  }

  if (request.method === "GET" && url.pathname === "/api/orders") {
    if (!isOperationsAuthorized(request)) {
      response.setHeader("WWW-Authenticate", 'Basic realm="Stopirex operations"');
      return json(response, 401, { error: "unauthorized" });
    }
    if (!orderInbox) {
      return json(response, 503, { error: "database_not_configured" });
    }
    try {
      return json(response, 200, await orderInbox.list());
    } catch (error) {
      logger.log("error", "order_inbox_list_failed", {
        traceId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      return json(response, 503, { error: "order_inbox_unavailable", traceId });
    }
  }

  // POST /api/orders/:id/completed  or  /api/orders/:id/cancelled
  const orderStatusMatch = url.pathname.match(/^\/api\/orders\/([a-f0-9-]{36})\/(completed|cancelled)$/);
  if (request.method === "POST" && orderStatusMatch) {
    if (!isOperationsAuthorized(request)) {
      response.setHeader("WWW-Authenticate", 'Basic realm="Stopirex operations"');
      return json(response, 401, { error: "unauthorized" });
    }
    if (!orderInbox) {
      return json(response, 503, { error: "database_not_configured" });
    }
    const [, orderId, newStatus] = orderStatusMatch as [string, string, "completed" | "cancelled"];
    let note: string | undefined;
    try {
      const body = JSON.parse((await readBody(request, 4_000)).toString("utf8")) as { note?: unknown };
      note = typeof body.note === "string" ? body.note.trim() || undefined : undefined;
    } catch {
      // note là optional, không bắt buộc
    }
    try {
      const updated = await orderInbox.updateStatus(orderId, newStatus, note);
      if (!updated) return json(response, 404, { error: "order_not_found" });
      logger.log("info", "order_inbox_status_updated", { traceId, orderId, newStatus });
      return json(response, 200, updated);
    } catch (error) {
      logger.log("error", "order_inbox_status_update_failed", {
        traceId,
        orderId,
        newStatus,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      return json(response, 503, { error: "order_inbox_unavailable", traceId });
    }
  }

  if (request.method === "GET" && url.pathname === "/api/product-information") {
    if (!isOperationsAuthorized(request)) {
      return json(response, 401, { error: "unauthorized" });
    }
    return json(response, 200, buildProductInformationSnapshot(knowledgeTenantId));
  }

  if (request.method === "GET" && url.pathname === "/api/operations/overview") {
    if (!isOperationsAuthorized(request)) {
      return json(response, 401, { error: "unauthorized" });
    }
    try {
      return json(response, 200, await operationsDashboard.snapshot());
    } catch (error) {
      logger.log("error", "operations_snapshot_failed", {
        traceId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      return json(response, 503, { error: "operations_snapshot_unavailable", traceId });
    }
  }

  if (request.method === "POST" && url.pathname === "/api/operations/restart") {
    if (!isLocalOperationsControlAuthorized(request)) {
      return json(response, 403, { error: "local_operations_control_only", traceId });
    }
    try {
      const result = await operationsControl.restartConnections();
      logger.log(result.status === "healthy" ? "info" : "warn", "operations_restart_completed", {
        traceId,
        status: result.status,
        steps: result.steps.map((step) => ({ id: step.id, status: step.status })),
      });
      return json(response, 200, result);
    } catch (error) {
      if (error instanceof OperationsControlBusyError) {
        return json(response, 409, { error: error.message, traceId });
      }
      logger.log("error", "operations_restart_failed", {
        traceId,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      return json(response, 503, { error: "operations_restart_failed", traceId });
    }
  }

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { status: "ok" });
  }

  if (request.method === "GET" && url.pathname === "/ready") {
    const [databaseReady, redisReady] = await Promise.all([
      postgres ? postgres.ready() : Promise.resolve(env.nodeEnv !== "production"),
      redis ? redis.ready() : Promise.resolve(env.nodeEnv !== "production"),
    ]);
    const ready = databaseReady && redisReady;
    return json(response, ready ? 200 : 503, {
      status: ready ? "ready" : "not_ready",
      mode: env.nodeEnv,
      dependencies: { database: databaseReady, redis: redisReady },
      llm: {
        provider: codexLlm.provider,
        enabled: codexLlm.enabled,
        role: "central_engine",
        model: codexLlm.model,
      },
    });
  }

  if (request.method === "GET" && url.pathname === "/openapi.json") {
    return json(response, 200, openApiContract);
  }

  if (request.method === "POST" && url.pathname === "/demo/chat") {
    let body: {
      sessionId?: unknown;
      text?: unknown;
      salutation?: unknown;
      customerFirstName?: unknown;
      staffFirstName?: unknown;
      openingVariantId?: unknown;
      includeSources?: unknown;
    };
    try {
      body = JSON.parse((await readBody(request, 20_000)).toString("utf8")) as typeof body;
    } catch (error) {
      logger.log("warn", "demo_chat_invalid_json", {
        traceId,
        reason: error instanceof Error ? error.message : "invalid_json",
      });
      return json(response, 400, { error: "invalid_json", traceId });
    }
    try {
      if (typeof body.text !== "string" || !body.text.trim())
        return json(response, 400, { error: "text_required" });
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      const context = demoChatContext(body);
      const includeSources = body.includeSources === true;
      if (codexLlm.enabled) {
        const stateBefore = demoChat.peek(sessionId);
        if (isDeterministicFastPath(body.text, stateBefore)) {
          let result = demoChat.chat(sessionId, body.text, {}, context);
          let quality = result.state.activeSkill
            ? evaluateConversationQuality({
                customerMessage: body.text,
                baseReply: result.reply,
                replies: result.replies,
                skill: result.state.activeSkill,
                ...(result.state.lastIntent ? { intent: result.state.lastIntent } : {}),
              })
            : undefined;
          const blockedReasons = quality && !quality.passed ? [...quality.hardFailReasons] : [];
          if (blockedReasons.length > 0) {
            const blockedReplies = qualityGateFallbackReplies(result.state);
            const blockedState = demoChat.replaceLatestAssistantTurnsAndPauseForCoverage(
              result.sessionId,
              result.replies,
              blockedReplies,
              `Quality Gate chặn phản hồi: ${blockedReasons.join(", ")}`,
            );
            result = {
              ...result,
              reply: blockedReplies.join("\n\n"),
              replies: blockedReplies,
              state: blockedState,
            };
            quality = evaluateConversationQuality({
              customerMessage: body.text,
              baseReply: result.reply,
              replies: result.replies,
              skill: "knowledge-handoff",
              intent: "knowledge_unknown",
            });
          }
          result = withTestKnowledgeSources(result, includeSources);
          return json(response, 200, {
            ...result,
            ...(quality ? { quality } : {}),
            ...(blockedReasons.length > 0 ? { qualityGate: { blocked: true, reasons: blockedReasons } } : {}),
            llm: {
              provider: codexLlm.provider,
              status: "skipped",
              model: codexLlm.model,
              latencyMs: 0,
              interpretation: {
                status: "skipped",
                latencyMs: 0,
                reason: "deterministic_transition",
              },
              composition: {
                status: "skipped",
                latencyMs: 0,
                reason: "deterministic_transition",
              },
              skill: {
                ...(result.state.activeSkill ? { selected: result.state.activeSkill } : {}),
                ...(result.state.skillReason ? { reason: result.state.skillReason } : {}),
                llmCalls: 0,
              },
            },
          });
        }
        const retrievedKnowledge = retrieveApprovedKnowledge(
          contextualKnowledgeQuery(body.text, stateBefore),
        );
        const interpretedRaw = await codexLlm.interpret({
          customerMessage: body.text,
          state: demoChat.peek(sessionId),
          knowledge: retrievedKnowledge,
        });
        const interpreted = attachRetrievedGrounding(interpretedRaw, retrievedKnowledge);
        const result = demoChat.chat(sessionId, body.text, interpreted, context);
        const composed = codexLlm.adoptInterpretedDraft({
          customerMessage: body.text,
          ...(interpreted.draftReply ? { draftReply: interpreted.draftReply } : {}),
          baseReply: result.reply,
          baseReplies: result.replies,
          actions: interpreted.actions ?? [],
          state: result.state,
          ...(result.state.activeSkill ? { skillId: result.state.activeSkill } : {}),
          knowledge: retrievedKnowledge,
          ...(interpreted.knowledgeIds ? { knowledgeIds: interpreted.knowledgeIds } : {}),
          ...(interpreted.unsupportedQuestions
            ? { unsupportedQuestions: interpreted.unsupportedQuestions }
            : {}),
          ...(interpreted.groundingConfidence !== undefined
            ? { groundingConfidence: interpreted.groundingConfidence }
            : {}),
          knowledgeGroundingRequired:
            requiresKnowledgeGrounding(result.state.decisionTrace?.selectedIntent) ||
            Boolean(
              interpreted.knowledgeIds?.length &&
              interpreted.actions?.some((action) => action.type === "answer_question"),
            ),
        });
        const candidate = applyComposedReply(result, composed.reply);
        const candidateQuality = candidate.state.activeSkill
          ? evaluateConversationQuality({
              customerMessage: body.text,
              baseReply: result.reply,
              replies: candidate.replies,
              skill: candidate.state.activeSkill,
              ...(candidate.state.lastIntent ? { intent: candidate.state.lastIntent } : {}),
              ...(typeof interpreted.asksDirectAnswer === "boolean"
                ? { asksDirectAnswer: interpreted.asksDirectAnswer }
                : {}),
              expectedQuestionEvidence: interpretedQuestionEvidence(interpreted),
            })
          : undefined;
        const candidateAccepted = !(candidateQuality && !candidateQuality.passed);
        let rendered = candidateAccepted ? candidate : result;
        if (
          candidateAccepted &&
          composed.status === "enhanced" &&
          rendered.state.decisionTrace &&
          interpreted.knowledgeIds
        ) {
          const retrievedIds = new Set(retrievedKnowledge.map((entity) => entity.id));
          rendered.state.decisionTrace.knowledgeEntityIds = [
            ...new Set([
              ...rendered.state.decisionTrace.knowledgeEntityIds,
              ...interpreted.knowledgeIds.filter((id) => retrievedIds.has(id)),
            ]),
          ];
        }
        if (rendered.reply !== result.reply) {
          const committedState = demoChat.replaceLatestAssistantTurns(
            rendered.sessionId,
            result.replies,
            rendered.replies,
          );
          rendered = { ...rendered, state: committedState };
        }
        const quality = rendered.state.activeSkill
          ? evaluateConversationQuality({
              customerMessage: body.text,
              baseReply: result.reply,
              replies: rendered.replies,
              skill: rendered.state.activeSkill,
              ...(rendered.state.lastIntent ? { intent: rendered.state.lastIntent } : {}),
              ...(typeof interpreted.asksDirectAnswer === "boolean"
                ? { asksDirectAnswer: interpreted.asksDirectAnswer }
                : {}),
              expectedQuestionEvidence: interpretedQuestionEvidence(interpreted),
            })
          : undefined;
        let sourced = withTestKnowledgeSources(rendered, includeSources);
        const blockedReasons = quality && !quality.passed ? [...quality.hardFailReasons] : [];
        if (blockedReasons.length > 0) {
          const blockedReplies = qualityGateFallbackReplies(sourced.state);
          const blockedState = demoChat.replaceLatestAssistantTurnsAndPauseForCoverage(
            sourced.sessionId,
            // Knowledge source labels are added only to the HTTP response. The
            // committed conversation history still contains the rendered
            // replies, so use that exact tail for the optimistic replacement.
            rendered.replies,
            blockedReplies,
            `Quality Gate chặn phản hồi: ${blockedReasons.join(", ")}`,
          );
          sourced = {
            ...sourced,
            reply: blockedReplies.join("\n\n"),
            replies: blockedReplies,
            state: blockedState,
          };
        }
        return json(response, 200, {
          ...sourced,
          ...(quality ? { quality } : {}),
          ...(blockedReasons.length > 0 ? { qualityGate: { blocked: true, reasons: blockedReasons } } : {}),
          llm: {
            provider: interpreted.provider,
            status: composed.status === "enhanced" ? "enhanced" : interpreted.status,
            model: interpreted.model,
            latencyMs: interpreted.latencyMs,
            interpretation: {
              status: interpreted.status,
              latencyMs: interpreted.latencyMs,
              ...(interpreted.reason ? { reason: interpreted.reason } : {}),
            },
            composition: {
              status: composed.status,
              latencyMs: 0,
              ...(composed.reason ? { reason: composed.reason } : {}),
            },
            skill: {
              ...(interpreted.skill ? { suggested: interpreted.skill } : {}),
              ...(rendered.state.activeSkill ? { selected: rendered.state.activeSkill } : {}),
              ...(rendered.state.skillReason ? { reason: rendered.state.skillReason } : {}),
              llmCalls: 1,
            },
          },
        });
      }
      return json(
        response,
        200,
        withTestKnowledgeSources(demoChat.chat(sessionId, body.text, {}, context), includeSources),
      );
    } catch (error) {
      const failure = classifyDemoChatFailure(error);
      logger.log("error", "demo_chat_pipeline_failed", {
        traceId,
        status: failure.status,
        code: failure.code,
        reason: error instanceof Error ? error.message : "unknown_error",
      });
      return json(response, failure.status, { error: failure.code, traceId });
    }
  }

  if (request.method === "POST" && url.pathname === "/demo/reset") {
    try {
      const body = JSON.parse((await readBody(request, 20_000)).toString("utf8")) as {
        sessionId?: unknown;
        salutation?: unknown;
        customerFirstName?: unknown;
        staffFirstName?: unknown;
        openingVariantId?: unknown;
      };
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      const context = demoChatContext(body);
      const result = demoChat.reset(sessionId, context);
      const baseOpening = result.state.recentTurns.at(-1)?.text;
      if (codexLlm.enabled && result.replies.length > 1 && baseOpening) {
        const safeBundle = [
          "Dạ em chào {{CUSTOMER_ADDRESS}} ạ! Em là {{STAFF_IDENTITY}} đây ạ.",
          baseOpening,
        ].join("\n\n");
        const composed = await codexLlm.enhanceOpening({
          baseReply: safeBundle,
          variantId: result.state.openingVariantId,
          styleSeed: sessionId ?? result.sessionId,
          includeGreeting: true,
        });
        const personalizedOpening = materializeOpeningIdentity(composed.reply, context.identity);
        const replies = splitCustomerFacingBlocks(personalizedOpening);
        const state = demoChat.replaceOpeningTurns(result.sessionId, replies);
        return json(response, 200, {
          ...result,
          reply: replies.join("\n\n"),
          replies,
          state,
          llm: {
            provider: composed.provider,
            status: composed.status,
            model: composed.model,
            latencyMs: composed.latencyMs,
            composition: {
              status: composed.status,
              latencyMs: composed.latencyMs,
              ...(composed.reason ? { reason: composed.reason } : {}),
            },
          },
        });
      }
      return json(response, 200, result);
    } catch {
      return json(response, 400, { error: "invalid_json" });
    }
  }

  if (request.method === "POST" && url.pathname === "/demo/free-shipping") {
    try {
      const body = JSON.parse((await readBody(request, 20_000)).toString("utf8")) as {
        sessionId?: unknown;
        salutation?: unknown;
        customerFirstName?: unknown;
        staffFirstName?: unknown;
        openingVariantId?: unknown;
      };
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      return json(response, 200, demoChat.approveFreeShipping(sessionId, demoChatContext(body)));
    } catch {
      return json(response, 400, { error: "invalid_json" });
    }
  }

  if (request.method === "POST" && url.pathname === "/demo/care/resume") {
    try {
      const body = JSON.parse((await readBody(request, 20_000)).toString("utf8")) as {
        sessionId?: unknown;
        resolved?: unknown;
        summary?: unknown;
        allowBotResume?: unknown;
      };
      if (
        typeof body.summary !== "string" ||
        !body.summary.trim() ||
        typeof body.resolved !== "boolean" ||
        typeof body.allowBotResume !== "boolean"
      ) {
        return json(response, 400, { error: "care_resume_fields_required" });
      }
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
      return json(response, 200, {
        sessionId,
        state: demoChat.resumeCareAfterHuman(sessionId, {
          resolved: body.resolved,
          summary: body.summary.trim(),
          allowBotResume: body.allowBotResume,
        }),
      });
    } catch {
      return json(response, 400, { error: "invalid_json" });
    }
  }

  if (request.method === "GET" && url.pathname === "/webhooks/meta") {
    const challenge = verifyMetaChallenge({
      mode: url.searchParams.get("hub.mode") ?? undefined,
      token: url.searchParams.get("hub.verify_token") ?? undefined,
      challenge: url.searchParams.get("hub.challenge") ?? undefined,
      expectedToken: env.metaVerifyToken,
    });
    if (!challenge) return json(response, 403, { error: "verification_failed" });
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    return response.end(challenge);
  }

  if (request.method === "POST" && url.pathname === "/webhooks/meta") {
    const body = await readBody(request, 1_000_000);
    if (
      !verifyMetaSignature(
        body,
        request.headers["x-hub-signature-256"] as string | undefined,
        env.metaAppSecret,
      )
    ) {
      return json(response, 401, { error: "invalid_signature" });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      return json(response, 400, { error: "invalid_json", traceId });
    }
    const events = parseMetaWebhook(payload);
    if (postgres) {
      for (const event of events) {
        if (event.isEcho) {
          if (isBotAuthoredEcho(event, env.metaAppId)) {
            logger.log("debug", "meta_bot_echo_ignored", {
              traceId,
              externalPageId: event.pageId,
              eventId: event.eventId,
              appId: event.appId,
            });
            continue;
          }
          const scope = await postgres.resolvePage(event.pageId);
          if (!scope) {
            logger.log("warn", "unregistered_page_human_echo", {
              traceId,
              externalPageId: event.pageId,
            });
            continue;
          }
          const takeover = await postgres.markHumanTakeover({
            ...scope,
            externalCustomerId: event.senderId,
            externalMessageId: event.eventId,
            ...(event.text ? { text: event.text } : {}),
            ...(event.appId ? { appId: event.appId } : {}),
            payload: event.payload,
          });
          logger.log("info", "meta_human_takeover_detected", {
            traceId,
            externalPageId: event.pageId,
            conversationId: takeover.conversationId,
            appId: event.appId ?? "page_inbox_or_unknown_app",
            cancelledFollowups: takeover.cancelledFollowups,
          });
          continue;
        }
        const scope = await postgres.resolvePage(event.pageId);
        if (!scope) {
          logger.log("warn", "unregistered_page_event", { traceId, externalPageId: event.pageId });
          continue;
        }
        const inserted = await postgres.persistInbound({
          ...scope,
          externalEventId: event.eventId,
          payload: event.payload,
        });
        if (inserted && redis) {
          await redis.enqueue("inbound", {
            traceId,
            ...scope,
            externalPageId: event.pageId,
            eventId: event.eventId,
            senderId: event.senderId,
            kind: event.kind,
            ...(event.text ? { text: event.text } : {}),
            ...(event.attachmentUrl ? { attachmentUrl: event.attachmentUrl } : {}),
            timestamp: event.timestamp.toISOString(),
            payload: event.payload,
            attempt: 0,
          });
        }
      }
    }
    logger.log("info", "meta_webhook_accepted", { traceId, eventCount: events.length });
    return json(response, 200, { accepted: true, events: events.length, traceId });
  }

  return json(response, 404, { error: "not_found" });
});

function readBody(request: import("node:http").IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) reject(new Error("payload_too_large"));
      else chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function json(response: import("node:http").ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function html(response: import("node:http").ServerResponse, status: number, body: string): void {
  response.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  response.end(body);
}

function isOperationsAuthorized(request: import("node:http").IncomingMessage): boolean {
  if (env.nodeEnv !== "production") return true;
  const supplied = request.headers["x-admin-api-key"];
  if (env.adminApiKey && supplied === env.adminApiKey) return true;
  const authorization = request.headers.authorization;
  if (!env.adminApiKey || !authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator >= 0 && decoded.slice(separator + 1) === env.adminApiKey;
  } catch {
    return false;
  }
}

function isLocalOperationsControlAuthorized(request: import("node:http").IncomingMessage): boolean {
  if (env.nodeEnv === "production") return false;
  const address = request.socket.remoteAddress ?? "";
  const loopback = address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
  if (!loopback) return false;
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

if (process.env.NODE_ENV !== "test") {
  const host = process.env.HOST ?? (env.nodeEnv === "production" ? "0.0.0.0" : "127.0.0.1");
  server.listen(env.port, host, () => {
    logger.log("info", "server_started", { port: env.port, host, mode: env.nodeEnv });
  });
}

export { server };

const openApiContract = {
  openapi: "3.1.0",
  info: { title: "Stopirex Chatbot API", version: "0.2.0" },
  paths: {
    "/health": { get: { responses: { "200": { description: "Liveness" } } } },
    "/ready": {
      get: {
        responses: {
          "200": { description: "Dependencies ready" },
          "503": { description: "Dependency unavailable" },
        },
      },
    },
    "/api/operations/overview": {
      get: {
        summary: "Operational connections, queues, and conversation sessions",
        responses: {
          "200": { description: "Current operational snapshot" },
          "401": { description: "Admin API key required in production" },
          "503": { description: "Snapshot unavailable" },
        },
      },
    },
    "/api/operations/restart": {
      post: {
        summary: "Restart local Meta processes and recheck external connections",
        responses: {
          "200": { description: "Restart completed" },
          "403": { description: "Local control only" },
          "409": { description: "Restart already in progress" },
        },
      },
    },
    "/api/product-information": {
      get: {
        summary: "Approved Stopirex product knowledge, offers, and blocked claims",
        responses: {
          "200": { description: "Current product information snapshot" },
          "401": { description: "Admin API key required in production" },
        },
      },
    },
    "/demo/chat": {
      post: {
        summary: "Stateful local sandbox conversation",
        responses: { "200": { description: "Reply and current conversation state" } },
      },
    },
    "/demo/reset": {
      post: {
        summary: "Reset a local sandbox conversation",
        responses: { "200": { description: "New initial state" } },
      },
    },
    "/demo/free-shipping": {
      post: {
        summary: "Approve a one-bottle free-shipping override in the local sandbox",
        responses: { "200": { description: "Updated conversation and order total" } },
      },
    },
    "/webhooks/meta": {
      get: {
        summary: "Meta webhook verification",
        responses: { "200": { description: "Challenge" }, "403": { description: "Invalid verify token" } },
      },
      post: {
        summary: "Persist signed Meta events",
        responses: {
          "200": { description: "Persisted/acknowledged" },
          "401": { description: "Invalid signature" },
        },
      },
    },
  },
};

function demoChatContext(body: {
  salutation?: unknown;
  customerFirstName?: unknown;
  staffFirstName?: unknown;
  openingVariantId?: unknown;
}): {
  identity: ConversationIdentity;
  openingVariantId?: OpeningVariantId;
} {
  const salutation =
    body.salutation === "anh" || body.salutation === "chị" || body.salutation === "anh/chị"
      ? body.salutation
      : undefined;
  const openingVariantId = openingVariants.some((item) => item.id === body.openingVariantId)
    ? (body.openingVariantId as OpeningVariantId)
    : undefined;
  return {
    identity: {
      ...(salutation ? { salutation } : {}),
      ...(typeof body.customerFirstName === "string" ? { customerFirstName: body.customerFirstName } : {}),
      ...(typeof body.staffFirstName === "string" ? { staffFirstName: body.staffFirstName } : {}),
    },
    ...(openingVariantId ? { openingVariantId } : {}),
  };
}

function retrieveApprovedKnowledge(query: string) {
  return retrieveKnowledge({
    tenantId: knowledgeTenantId,
    query,
    entities: approvedKnowledge,
    limit: 3,
  }).map(({ id, title, content }) => ({ id, title, content }));
}

/**
 * A model can occasionally produce a grounded draft and answer actions but
 * omit the citation array. Resolve that omission from the already-retrieved
 * candidates instead of letting the legacy discovery flow replace the answer.
 * This is citation repair only: it neither creates an intent nor a claim.
 */
function attachRetrievedGrounding(
  interpreted: CodexInterpretResult,
  retrieved: readonly ApprovedKnowledgeContext[],
): CodexInterpretResult {
  const allowed = new Set(retrieved.map((entity) => entity.id));
  const validCitations = (interpreted.knowledgeIds ?? []).filter((id) => allowed.has(id));
  if (validCitations.length > 0) {
    return validCitations.length === interpreted.knowledgeIds?.length
      ? interpreted
      : { ...interpreted, knowledgeIds: validCitations };
  }
  if (
    !interpreted.draftReply?.trim() ||
    !interpreted.actions?.some((action) => action.type === "answer_question") ||
    retrieved.length === 0
  ) {
    return interpreted;
  }
  const matchedIds = retrieveKnowledge({
    tenantId: knowledgeTenantId,
    query: interpreted.draftReply,
    entities: approvedKnowledge,
    limit: 3,
  })
    .map((entity) => entity.id)
    .filter((id) => allowed.has(id))
    .slice(0, 2);
  if (matchedIds.length === 0) return interpreted;
  const withoutInvalidCitations = { ...interpreted };
  delete withoutInvalidCitations.knowledgeIds;
  return repairMissingKnowledgeCitations(withoutInvalidCitations, matchedIds);
}

function contextualKnowledgeQuery(customerMessage: string, state: DemoChatState): string {
  const normalized = customerMessage
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/gu, "d")
    .trim();
  const needsPriorContext =
    customerMessage.trim().length < 55 ||
    /^(?:the|vay|con|loai nay|cai nay|no|nhu tren|nhu vay)\b/.test(normalized);
  if (!needsPriorContext) return customerMessage;
  const priorCustomerTurns = state.recentTurns
    .filter((turn) => turn.role === "user")
    .slice(-2)
    .map((turn) => turn.text.replace(/(?<!\d)0\d{9}(?!\d)/gu, "[SĐT]"));
  return [...priorCustomerTurns, customerMessage].join("\n");
}

function interpretedQuestionEvidence(interpreted: CodexInterpretResult): string[] {
  return (interpreted.actions ?? [])
    .filter((action) => action.type === "answer_question")
    .map((action) => action.evidence.join(" "))
    .filter(Boolean);
}

function withTestKnowledgeSources(result: DemoChatResponse, enabled: boolean): DemoChatResponse {
  if (!enabled) return result;
  const ids = result.state.decisionTrace?.knowledgeEntityIds ?? [];
  if (ids.length === 0) return result;
  const sourceLine = `Nguồn: ${[...new Set(ids)].join(", ")}`;
  const replies = [...result.replies];
  const last = replies.at(-1) ?? result.reply;
  replies[replies.length - 1] = `${last}\n\n${sourceLine}`;
  return { ...result, replies, reply: replies.join("\n\n") };
}

function isDeterministicFastPath(customerMessage: string, state: DemoChatState): boolean {
  const text = customerMessage
    .toLocaleLowerCase("vi-VN")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/đ/g, "d")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    isInternalSystemProbe(customerMessage) ||
    isInternationalShippingQuestion(customerMessage) ||
    isOutOfScopeAssistantProbe(customerMessage) ||
    isWholesaleDealerInquiry(customerMessage) ||
    isDomesticDeliveryEtaQuestion(customerMessage) ||
    isPriceAndShippingPolicyQuestion(customerMessage) ||
    isQuantityShippingPolicyQuestion(customerMessage) ||
    isOrderCaptureMessage(customerMessage) ||
    (Boolean(state.selectedQuantity) && isCompoundOrderUpdateQuestion(customerMessage)) ||
    isPriceConcern(text)
  ) {
    return true;
  }
  if (
    state.pendingAction === "choose_quantity" &&
    /^(?:1|2|1 lo|2 lo|mot lo|hai lo|combo)(?: a| nhe| nha)?$/.test(text)
  ) {
    return true;
  }
  if (
    state.pendingAction === "confirm_order" &&
    /^(?:dung|dung roi|dong y|toi dong y|xac nhan dong y)$/.test(text)
  ) {
    return true;
  }
  if (
    state.selectedQuantity &&
    state.orderMissing.length > 0 &&
    !/[?？]/u.test(customerMessage) &&
    (/(?<!\d)0\d{9}(?!\d)/u.test(customerMessage) ||
      isLikelyAdministrativeFragment(customerMessage) ||
      /\b(?:ten nguoi nhan|sdt|so dien thoai|dia chi|phuong|xa|thi tran|quan|huyen|tinh|thanh pho)\b/.test(
        text,
      ))
  ) {
    return true;
  }
  if (
    state.pipeline === "6.Đã tạo đơn" &&
    /^(?:dung|dung roi|dong y|ok|okay|cam on|thanks)(?: a| nhe| nha)?$/.test(text)
  ) {
    return true;
  }
  if (/^(?:gia|bao gia|xin gia|gia bao nhieu|bao nhieu tien)(?: a| nhe| nha)?[?？]?$/.test(text)) {
    return true;
  }
  if (/^(?:stop|huy dang ky|khong nhan nua|dung nhan)$/.test(text)) {
    return true;
  }
  return false;
}

function classifyDemoChatFailure(error: unknown): {
  status: 500 | 503 | 504;
  code: "chat_pipeline_failed" | "llm_provider_unavailable" | "llm_provider_timeout";
} {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (/timeout|timed out|aborterror|etimedout/.test(message)) {
    return { status: 504, code: "llm_provider_timeout" };
  }
  if (/429|quota|rate limit|provider|hybrid_exhausted|econnrefused|enotfound/.test(message)) {
    return { status: 503, code: "llm_provider_unavailable" };
  }
  return { status: 500, code: "chat_pipeline_failed" };
}

function qualityGateFallbackReplies(state: DemoChatState): string[] {
  const acknowledgement = state.selectedQuantity
    ? `Dạ em đã ghi nhận mình chọn ${state.selectedQuantity === 1 ? "1 lọ" : `combo ${state.selectedQuantity} lọ`} ạ.`
    : undefined;
  return [
    ...(acknowledgement ? [acknowledgement] : []),
    "Phần phản hồi vừa xử lý chưa đạt kiểm tra nội dung nên em chưa gửi thông tin chưa chắc chắn. Em chuyển bộ phận liên quan kiểm tra và phản hồi mình ạ.",
  ].slice(0, 2);
}

function applyComposedReply(result: DemoChatResponse, composedReply: string): DemoChatResponse {
  if (!composedReply.trim() || composedReply === result.reply) return result;
  const governed = governCustomerResponse({
    replies: [composedReply],
    answeredTopics: result.state.answeredTopics,
    previouslyAskedTopics: result.state.askedTopics,
    preserveFullText:
      result.state.mode === "care" || Boolean(result.state.selectedQuantity) || Boolean(result.state.orderId),
  });
  const replies = governed.replies.length > 0 ? governed.replies : [result.reply];
  return {
    ...result,
    reply: replies.join("\n\n"),
    replies,
    state: {
      ...result.state,
      askedTopics: [...new Set([...result.state.askedTopics, ...governed.askedTopics])],
      ...(governed.pendingQuestionTopic ? { pendingQuestionTopic: governed.pendingQuestionTopic } : {}),
      responseGovernorTruncated: governed.truncated,
    },
  };
}

function splitCustomerFacingBlocks(reply: string): string[] {
  const rawBlocks = reply
    .split(/\n\s*\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const blocks = mergeOpeningChoiceBlocks(rawBlocks);
  if (blocks.length === 0) return [reply.trim()];
  if (blocks.length > 2 && /chào|bộ phận tư vấn|Stopirex/iu.test(blocks[0] ?? "")) {
    return [blocks[0] ?? "", blocks.slice(1).join("\n\n")];
  }
  return blocks.slice(0, 2);
}

function mergeOpeningChoiceBlocks(blocks: string[]): string[] {
  for (let index = 1; index < blocks.length; index += 1) {
    if (!/^\s*1[.)]\s+/u.test(blocks[index] ?? "")) continue;
    const previous = blocks[index - 1] ?? "";
    if (/chào|bộ phận tư vấn|Stopirex đây/iu.test(previous)) return blocks;
    return [...blocks.slice(0, index - 1), `${previous}\n\n${blocks[index]}`, ...blocks.slice(index + 1)];
  }
  return blocks;
}

function materializeOpeningIdentity(reply: string, identity: ConversationIdentity): string {
  const salutation = identity.salutation ?? "anh/chị";
  const customerName = safeOpeningName(identity.customerFirstName);
  const staffName = safeOpeningName(identity.staffFirstName);
  const customerAddress = customerName ? `${salutation} ${customerName}` : salutation;
  const staffIdentity = staffName ? `${staffName}, bộ phận tư vấn của Stopirex` : "tư vấn viên của Stopirex";
  const capitalizedSalutation = `${salutation.charAt(0).toUpperCase()}${salutation.slice(1)}`;
  return reply
    .replaceAll("{{CUSTOMER_ADDRESS}}", customerAddress)
    .replaceAll("{{STAFF_IDENTITY}}", staffIdentity)
    .replaceAll("Anh/chị", capitalizedSalutation)
    .replaceAll("anh/chị", salutation);
}

function safeOpeningName(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/[<>{}#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 40);
  return cleaned || undefined;
}

const demoPage = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Stopirex Chatbot — Local Test</title><style>
*{box-sizing:border-box}body{margin:0;font-family:Montserrat,Arial,sans-serif;background:#f1f5fb;color:#152238}main{max-width:1180px;margin:28px auto;padding:0 18px}.hero,.panel{background:#fff;border:1px solid #d9e3f0;border-radius:18px;box-shadow:0 8px 28px #193e6b12}.hero{padding:22px 26px;background:linear-gradient(135deg,#123f8c,#2266d1);color:#fff}.hero h1{margin:0 0 8px}.hero p{margin:0;opacity:.9}.tabs{display:flex;gap:6px;margin:14px 0;padding:5px;background:#e4eaf3;border-radius:12px;width:max-content}.tab{padding:9px 14px;border-radius:9px;color:#4a5870;text-decoration:none;font-weight:700;font-size:14px}.tab.active{background:#fff;color:#19489f;box-shadow:0 2px 8px #17294a16}.status{display:flex;gap:10px;margin:14px 0}.badge{background:#fff;border:1px solid #d9e3f0;border-radius:99px;padding:8px 12px;font-size:13px}.ok{color:#087f5b}.layout{display:grid;grid-template-columns:minmax(0,1.75fr) minmax(290px,.85fr);gap:16px}.panel{padding:20px}.panel h2{margin:0 0 8px}.note{font-size:13px;color:#5c6f88}.matrix-info{font-size:12px;line-height:1.5;padding:10px 12px;border:1px solid #c9daf3;border-radius:10px;background:#f6f9ff;color:#35506f}.matrix-info b{color:#154786}.chat{height:470px;overflow:auto;background:#f7f9fc;border:1px solid #e0e8f3;border-radius:14px;padding:14px;margin:14px 0}.msg{max-width:82%;padding:14px 16px;margin:9px 0;border-radius:14px;white-space:pre-wrap;line-height:1.55}.bot{background:#e5edfb}.user{background:#1762cc;color:#fff;margin-left:auto}form{display:flex;gap:8px}input[type=text]{flex:1;min-width:0;padding:13px;border:1px solid #b9c8db;border-radius:11px;font:inherit}button{border:0;background:#1762cc;color:#fff;border-radius:10px;padding:0 18px;font-weight:700;cursor:pointer}button:disabled{opacity:.6;cursor:wait}.secondary{background:#e7eef8;color:#154786;padding:10px 13px}.approve{background:#0b8f62;color:#fff;padding:10px 13px}.quick{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.quick button{font-size:12px;padding:8px 10px}.llm-toggle{display:flex;align-items:flex-start;gap:9px;margin:12px 0;padding:11px;border:1px solid #c9daf3;border-radius:11px;background:#f1f6ff;font-size:13px}.llm-toggle input{margin-top:2px}.opening-config{display:grid;grid-template-columns:1.4fr .7fr 1fr 1fr;gap:8px;margin:10px 0}.opening-config label{font-size:11px;color:#5c6f88}.opening-config input,.opening-config select{width:100%;margin-top:4px;padding:9px;border:1px solid #b9c8db;border-radius:9px;background:#fff;font:inherit;font-size:12px}.state{display:grid;gap:10px;margin-top:15px}.state div{border:1px solid #e0e8f3;border-radius:10px;padding:10px}.state label{display:block;font-size:11px;text-transform:uppercase;color:#6c7e95;margin-bottom:4px}.state strong,.state code{overflow-wrap:anywhere}.slots{font-size:12px;white-space:pre-wrap;line-height:1.5}.warning{margin-top:14px;padding:12px;border-radius:10px;background:#fff4e5;color:#8b4b00;font-size:13px}a{color:#1762cc}@media(max-width:820px){.layout{grid-template-columns:1fr}.chat{height:400px}.status{flex-wrap:wrap}.opening-config{grid-template-columns:1fr 1fr}.tabs{width:100%}.tab{flex:1;text-align:center}}
</style></head><body><main>
<section class="hero"><h1>Stopirex Chatbot — Local Sandbox</h1><p>Một hành trình khách hàng chung: Sale + CSKH, có Pipeline và điểm gãy theo từng nhánh.</p></section>
<nav class="tabs"><a class="tab active" href="/">Chat thử</a><a class="tab" href="/operations">Tổng quan kết nối</a><a class="tab" href="/product">Thông tin sản phẩm</a></nav>
<section class="status"><span class="badge ok">● API :${env.port}</span><span class="badge">Meta ${env.metaActivePage} · gửi ${env.metaLiveSendEnabled ? "bật" : "tắt"}</span><span class="badge"><a href="/operations">Xem healthcheck trực tiếp →</a></span></section>
<section class="layout"><div class="panel"><h2>Chat thử</h2><div class="note">Đi theo một luồng hoặc bấm tình huống nhanh. Bot sẽ giữ đầy đủ ngữ cảnh trong cùng phiên.</div><div class="llm-toggle"><span><b>${codexLlm.provider === "openai" ? "OpenAI API trực tiếp" : "Codex CLI dự phòng"} · ${codexLlm.model}</b><br>LLM đọc ngữ cảnh, xác định ý định, lấy kiến thức được duyệt và diễn đạt câu trả lời. Flow chỉ giữ trạng thái; giá, an toàn, dữ liệu đơn và guardrail vẫn do hệ thống kiểm soát.</span></div>
<div class="opening-config"><label>Mẫu mở đầu<select id="openingVariant">${openingVariants.map((item) => `<option value="${item.id}">${item.id} · ${item.label}</option>`).join("")}</select></label><label>Xưng hô<select id="salutation"><option value="anh">Anh</option><option value="chị">Chị</option><option value="anh/chị">Anh/chị</option></select></label><label>Tên khách<input id="customerName" value="Minh" maxlength="40"></label><label>Tên nhân viên<input id="staffName" value="Linh" maxlength="40"></label></div>
<div id="matrixInfo" class="matrix-info"></div>
<div class="note">Đổi mẫu mở đầu sẽ tự tạo phiên mới để chạy đúng chiến lược đã chọn.</div>
<div id="chat" class="chat"></div><form id="form"><input id="text" autocomplete="off" placeholder="Nhập tin nhắn..."><button id="send">Gửi</button></form>
<div class="quick"><button class="secondary" data-text="Tư vấn giúp mình">Khách mới</button><button class="secondary" data-text="Giá bao nhiêu?">Hỏi giá</button><button id="approveFreeShipping" class="approve" type="button">Duyệt freeship 1 lọ</button><button class="secondary" data-text="Mình dùng bị rát và da đang đỏ">Kích ứng</button><button class="secondary" data-text="Dùng rồi nhưng vẫn ra mồ hôi">Không hiệu quả</button><button class="secondary" data-text="Hộp bị móp và sản phẩm bị đổ">Hàng hỏng</button><button class="secondary" data-text="Đơn giao chậm chưa nhận được">Giao chậm</button><button class="secondary" data-text="Tôi đã đánh giá 1 sao vì sản phẩm">Đánh giá xấu</button></div></div>
<aside class="panel"><div style="display:flex;justify-content:space-between;gap:10px;align-items:center"><h2>Trạng thái bot</h2><button id="reset" class="secondary">Làm mới</button></div>
	<div class="state"><div><label>Chế độ</label><strong id="mode">SALE · Khách mới</strong></div><div><label>Chiến lược hội thoại</label><strong id="openingState">AUTO.dynamic</strong><div id="strategyReason" class="slots">Chờ tin nhắn đầu tiên</div></div><div><label>Kỹ năng đang dùng</label><strong id="activeSkill">—</strong><div id="skillReason" class="slots">Chờ tin nhắn</div></div><div><label>Kiểm tra chất lượng</label><strong id="qualityStatus">—</strong><div id="qualityReason" class="slots">Chưa có lượt đánh giá</div></div><div><label>Ý định cuối</label><strong id="intent">—</strong></div><div><label>Pipeline</label><strong id="pipeline">0.Chưa tư vấn</strong></div><div><label>Pipeline trước sự cố</label><strong id="previousPipeline">—</strong></div><div><label>Nhánh / bước hiện tại</label><code id="stage">S0.new</code></div><div><label>Điểm gãy cần xử lý</label><strong id="breakpoint">Chưa tiếp nhận</strong></div><div><label>LLM</label><strong id="llmStatus">${codexLlm.model} · Sẵn sàng</strong></div><div><label>LLM hiểu</label><div id="semanticTrace" class="slots">Chưa có lượt phân tích</div></div><div><label>Rule khớp</label><div id="ruleTrace" class="slots">—</div></div><div><label>Xung đột</label><div id="conflictTrace" class="slots">—</div></div><div><label>Quyết định cuối</label><strong id="routeTrace">—</strong></div><div><label>Lý do chọn</label><div id="reasonTrace" class="slots">—</div></div><div><label>Nguồn kiến thức</label><div id="knowledgeTrace" class="slots">—</div></div><div><label>Đang chờ khách trả lời</label><strong id="pendingTrace">—</strong></div><div><label>Cản trở / sự cố</label><strong id="signal">—</strong></div><div><label>Bot đã tạm dừng?</label><strong id="paused">Không</strong></div><div><label>Gói đã chọn</label><strong id="quantity">—</strong></div><div><label>Ưu đãi ship</label><strong id="shippingOverride">Chưa duyệt</strong></div><div><label>Dữ liệu đã nhớ</label><div id="slots" class="slots">Chưa có</div></div><div><label>Đơn còn thiếu</label><div id="missing" class="slots">Chưa chọn gói</div></div></div>
<div class="warning"><b>Lưu ý:</b> Giá hiển thị được gắn nhãn SANDBOX để test chức năng. Đơn tạo ra không phải đơn thật.</div><p class="note"><a href="/ready">Kiểm tra hệ thống</a> · <a href="/openapi.json">OpenAPI</a></p></aside></section></main>
<script>
const form=document.getElementById('form'),input=document.getElementById('text'),chat=document.getElementById('chat'),send=document.getElementById('send'),approveFreeShipping=document.getElementById('approveFreeShipping'),llmStatus=document.getElementById('llmStatus'),openingVariant=document.getElementById('openingVariant'),salutation=document.getElementById('salutation'),customerName=document.getElementById('customerName'),staffName=document.getElementById('staffName'),llmDefaultModel=${JSON.stringify(codexLlm.model)},llmDefaultProvider=${JSON.stringify(codexLlm.provider)};let sessionId=localStorage.getItem('stopirex-demo-session')||crypto.randomUUID();localStorage.setItem('stopirex-demo-session',sessionId);llmStatus.textContent=llmDefaultModel+' · '+(llmDefaultProvider==='openai'?'OpenAI API':'Codex CLI')+' · Sẵn sàng';
const openingMatrix=${JSON.stringify(openingVariants.map(({ id, strategy, path }) => ({ id, strategy, path })))};const updateMatrixInfo=()=>{const item=openingMatrix.find(row=>row.id===openingVariant.value);document.getElementById('matrixInfo').innerHTML=item?'<b>'+item.strategy+'</b><br>'+item.path:''};updateMatrixInfo();
const add=(t,c)=>{const d=document.createElement('div');d.className='msg '+c;const pattern=/https:\\/\\/spx\\.vn\\/track\\?[A-Za-z0-9-]+/g;let last=0;for(const match of t.matchAll(pattern)){d.append(document.createTextNode(t.slice(last,match.index)));const a=document.createElement('a');a.href=match[0];a.target='_blank';a.rel='noopener noreferrer';a.textContent=match[0];d.append(a);last=(match.index||0)+match[0].length}d.append(document.createTextNode(t.slice(last)));chat.appendChild(d);chat.scrollTop=chat.scrollHeight};
const context=()=>({openingVariantId:openingVariant.value,salutation:salutation.value,customerFirstName:customerName.value,staffFirstName:staffName.value});
const addReplies=j=>(j.replies&&j.replies.length?j.replies:[j.reply||j.error]).forEach(message=>add(message,'bot'));
const labels={workContext:'Môi trường',primarySymptom:'Tình trạng',sweatPresent:'Áo bị ướt/ố',odorPresent:'Có mùi',priorProduct:'Sản phẩm cũ',priorIrritation:'Từng kích ứng',activeIrritation:'Kích ứng hiện tại',damagedSkin:'Da tổn thương',recentShaveWaxLaser:'Vừa cạo/wax/triệt',usedAtNight:'Dùng buổi tối',skinDry:'Da khô',frequencyPerWeek:'Lần/tuần',orderId:'Mã đơn',damageKind:'Dạng hỏng',deliveryKind:'Lỗi giao',purchaseChannel:'Kênh mua',reviewProblem:'Vấn đề đánh giá',desiredResolution:'Mong muốn'};
	const render=(s,quality)=>{const trace=s.decisionTrace||{};const semantic=trace.semantic||{};document.getElementById('mode').textContent=(s.mode==='care'?'CSKH':'SALE')+' · '+(s.customerType==='returning'?'Khách cũ':'Khách mới');document.getElementById('openingState').textContent=(s.openingVariantId||'—')+(s.openingSelectionMode==='auto'?' · AUTO':'');document.getElementById('strategyReason').textContent=s.openingStrategyReason||'Chờ tin nhắn đầu tiên';document.getElementById('activeSkill').textContent=s.activeSkill||'—';document.getElementById('skillReason').textContent=s.skillReason||'Chờ tin nhắn';document.getElementById('qualityStatus').textContent=quality?(quality.passed?'Đạt':'Cần kiểm tra'):'—';document.getElementById('qualityReason').textContent=quality?(quality.passed?'Đúng ý · tối đa 1 câu hỏi · có bước tiếp theo · không lộ nội bộ':quality.hardFailReasons.join(' · ')):'Chưa có lượt đánh giá';document.getElementById('intent').textContent=[s.lastIntent||'—',...(trace.secondaryIntents||[])].join(' + ');document.getElementById('pipeline').textContent=s.pipeline;document.getElementById('previousPipeline').textContent=s.previousSalesPipeline||'—';document.getElementById('stage').textContent=s.journeyStage||s.consultationStage;document.getElementById('breakpoint').textContent=s.breakpoint||'—';document.getElementById('semanticTrace').textContent=trace.semantic?['Intent: '+(semantic.intent||'—'),trace.secondaryIntents&&trace.secondaryIntents.length?'Intent phụ: '+trace.secondaryIntents.join(' + '):'','Skill LLM đề xuất: '+(semantic.skill||'—'),'Chủ đề: '+(semantic.topic||'—'),'Chủ thể: '+(semantic.subject||'—'),'Tình huống: '+(semantic.scenario||'—'),'Trả lời việc: '+(semantic.replyTo||'—'),'Tin cậy: '+Math.round((semantic.confidence||0)*100)+'%',semantic.evidence&&semantic.evidence.length?'Bằng chứng: '+semantic.evidence.join(' · '):''].filter(Boolean).join('\\n'):'Chưa có lượt phân tích';document.getElementById('ruleTrace').textContent=trace.ruleMatches&&trace.ruleMatches.length?trace.ruleMatches.map(r=>r.id+' · '+r.kind+' · '+Math.round(r.confidence*100)+'%').join('\\n'):'—';document.getElementById('conflictTrace').textContent=trace.conflicts&&trace.conflicts.length?trace.conflicts.join('\\n'):'—';document.getElementById('routeTrace').textContent=trace.selectedRoute?(trace.selectedRoute+(trace.selectedIntent?' · '+trace.selectedIntent:'')+(trace.secondaryIntents&&trace.secondaryIntents.length?' + '+trace.secondaryIntents.join(' + '):'')+(trace.selectedCareIssue?' · '+trace.selectedCareIssue:'')):'—';document.getElementById('reasonTrace').textContent=trace.reason||'—';document.getElementById('knowledgeTrace').textContent=trace.knowledgeEntityIds&&trace.knowledgeEntityIds.length?trace.knowledgeEntityIds.join('\\n'):'—';document.getElementById('pendingTrace').textContent=s.pendingAction||'—';document.getElementById('signal').textContent=s.signal||'—';document.getElementById('paused').textContent=s.botPaused?'Có — chờ nhân viên':'Không';document.getElementById('quantity').textContent=s.selectedQuantity?s.selectedQuantity+' lọ':'—';document.getElementById('shippingOverride').textContent=s.freeShippingApproved?'Đã duyệt 1 lọ':'Chưa duyệt';approveFreeShipping.disabled=Boolean(s.freeShippingApproved);approveFreeShipping.textContent=s.freeShippingApproved?'Đã duyệt freeship':'Duyệt freeship 1 lọ';const memory={...(s.slots||{}),...(s.careFacts||{})};const entries=Object.entries(memory);document.getElementById('slots').textContent=entries.length?entries.map(([k,v])=>(labels[k]||k)+': '+v).join('\\n'):'Chưa có';document.getElementById('missing').textContent=s.selectedQuantity?(s.orderMissing.length?s.orderMissing.join(', '):'Đã đủ dữ liệu'):'Chưa chọn gói'};
async function post(path,body){send.disabled=true;send.textContent='Đang xử lý…';llmStatus.textContent=llmDefaultModel+' · Đang đọc ngữ cảnh…';try{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const j=await r.json();if(j.sessionId){sessionId=j.sessionId;localStorage.setItem('stopirex-demo-session',sessionId)}if(j.state)render(j.state,j.quality);if(j.llm){const names={enhanced:'Đã hiểu + diễn đạt',interpreted:'Đã hiểu ý',skipped:'Bảo vệ dữ liệu · dùng flow',fallback:'LLM lỗi · rule dự phòng',unavailable:'LLM chưa sẵn sàng'};const provider=j.llm.provider==='openai'?'OpenAI API':'Codex CLI';llmStatus.textContent=(j.llm.model||llmDefaultModel)+' · '+provider+' · '+(names[j.llm.status]||j.llm.status)+' · '+(j.llm.latencyMs/1000).toFixed(1)+'s'}else llmStatus.textContent=llmDefaultModel+' · Sẵn sàng';return j}finally{send.disabled=false;send.textContent='Gửi';input.focus()}}
async function reset(){chat.innerHTML='';const j=await post('/demo/reset',{sessionId,...context()});addReplies(j)}
form.addEventListener('submit',async e=>{e.preventDefault();const t=input.value.trim();if(!t)return;add(t,'user');input.value='';const j=await post('/demo/chat',{sessionId,text:t,...context()});addReplies(j)});
document.querySelectorAll('[data-text]').forEach(b=>b.addEventListener('click',()=>{input.value=b.dataset.text;form.requestSubmit()}));document.getElementById('reset').addEventListener('click',reset);openingVariant.addEventListener('change',()=>{sessionId=crypto.randomUUID();localStorage.setItem('stopirex-demo-session',sessionId);updateMatrixInfo();reset()});reset();
approveFreeShipping.addEventListener('click',async()=>{approveFreeShipping.disabled=true;const j=await post('/demo/free-shipping',{sessionId,...context()});addReplies(j)});
</script></body></html>`;
