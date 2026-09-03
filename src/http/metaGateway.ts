import { createServer, request as httpRequest } from "node:http";
import { pipeline } from "node:stream";

const port = positivePort(process.env.META_GATEWAY_PORT ?? "8081");
const targetPort = positivePort(process.env.PORT ?? "8080");
const allowedHeaders = ["content-type", "x-hub-signature-256", "x-request-id"] as const;

const server = createServer((incoming, outgoing) => {
  const url = new URL(incoming.url ?? "/", `http://${incoming.headers.host ?? "localhost"}`);
  if (url.pathname !== "/webhooks/meta" || (incoming.method !== "GET" && incoming.method !== "POST")) {
    outgoing.writeHead(404, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    outgoing.end(JSON.stringify({ error: "not_found" }));
    return;
  }

  const headers = Object.fromEntries(
    allowedHeaders.flatMap((name) => {
      const value = incoming.headers[name];
      return value ? [[name, value]] : [];
    }),
  );
  const upstream = httpRequest(
    {
      hostname: "127.0.0.1",
      port: targetPort,
      method: incoming.method,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: 10_000,
    },
    (upstreamResponse) => {
      outgoing.writeHead(upstreamResponse.statusCode ?? 502, {
        "content-type": upstreamResponse.headers["content-type"] ?? "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
      pipeline(upstreamResponse, outgoing, () => undefined);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", () => {
    if (!outgoing.headersSent) {
      outgoing.writeHead(502, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      });
    }
    outgoing.end(JSON.stringify({ error: "bad_gateway" }));
  });
  pipeline(incoming, upstream, () => undefined);
});

server.listen(port, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      event: "meta_gateway_started",
      host: "127.0.0.1",
      port,
      targetPort,
      allowedPath: "/webhooks/meta",
    }),
  );
});

function positivePort(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error(`Invalid port: ${value}`);
  }
  return parsed;
}
