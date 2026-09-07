import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Run on the product Docker host. Default is a read-only preflight.
const apply = process.argv.includes("--apply");
const selectedIndex = process.argv.indexOf("--api-container");
const proxy = "chatbot-ts-proxy-stable";
function docker(...args) {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
const candidates =
  selectedIndex >= 0
    ? [process.argv[selectedIndex + 1]]
    : docker("ps", "--filter", "label=coolify.applicationId=5", "--format", "{{.Names}}")
        .split("\n")
        .filter(Boolean);
if (candidates.length !== 1 || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]+$/.test(candidates[0] ?? "")) {
  throw new Error("Expected exactly one product API container; refusing ambiguous routing");
}
const api = candidates[0];
const [apiInfo, proxyInfo] = JSON.parse(docker("inspect", api, proxy));
if (!apiInfo.State.Running || !proxyInfo.State.Running) throw new Error("API/proxy must be running");
if (!Object.keys(apiInfo.NetworkSettings.Networks).some((key) => key in proxyInfo.NetworkSettings.Networks)) {
  throw new Error("API and proxy do not share a Docker network");
}
const ready = JSON.parse(
  docker("exec", api, "curl", "-fsS", "--max-time", "10", "http://127.0.0.1:8080/ready"),
);
if (ready.status !== "ready") throw new Error("API dependencies are not ready");
const config = `server {
  listen 80;
  resolver 127.0.0.11 valid=10s ipv6=off;
  set $stopirex_api ${api}:8080;
  location / {
    proxy_pass http://$stopirex_api;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_connect_timeout 5s;
    proxy_read_timeout 90s;
  }
}
`;
console.log(JSON.stringify({ api, image: apiInfo.Image, proxy, ready: ready.status, apply }));
if (apply) {
  const backup = mkdtempSync(join(tmpdir(), "stopirex-proxy-recovery-"));
  const original = join(backup, "default.conf.before");
  const next = join(backup, "default.conf");
  docker("cp", `${proxy}:/etc/nginx/conf.d/default.conf`, original);
  writeFileSync(next, config, { mode: 0o600 });
  try {
    docker("cp", next, `${proxy}:/etc/nginx/conf.d/default.conf`);
    docker("exec", proxy, "nginx", "-t");
    docker("exec", proxy, "nginx", "-s", "reload");
  } catch (error) {
    docker("cp", original, `${proxy}:/etc/nginx/conf.d/default.conf`);
    throw error;
  }
  console.log(JSON.stringify({ event: "product_proxy_restored", backup, api }));
}
