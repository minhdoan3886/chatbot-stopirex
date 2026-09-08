# Stopirex product hardening — 2026-09-08

## Implementation order

1. P0: restore the product endpoint and staging dependencies.
2. P0: release API, Meta worker and follow-up worker from one image SHA.
3. P0: queue recovery, dead letters, renewable conversation leases and Page isolation.
4. P1: use the same conversation engine for local tests and Meta production.
5. P1: bound LLM calls, separate semantic decisions from committed-state responses.
6. P1: version approved knowledge and structured commercial facts.
7. P1: separate conversation episodes/channels and minimize PII in prompts/cache.
8. P2: improve comment style, add correlated telemetry and offline eval gates.

No live OpenAI tests are authorized for this work; verification uses existing health,
logs, deterministic fixtures and isolated PostgreSQL/Redis integration tests.

## Recovery record

On 2026-09-08, the product endpoint was restored on the fixed Tailscale domain,
the staging Redis AOF was repaired from a preserved backup, and API, Meta worker
and follow-up worker were aligned on release
`91f96faec255c8668a10c98ab0629a04751aa464`. Direct API readiness reported both
PostgreSQL and Redis healthy; the product consumer group had zero pending and zero
lag.

The stable nginx proxy now routes the Tailscale Funnel directly to the current API
through Docker DNS. It does not depend on Coolify's failed host-port-443 proxy.

## Recovery tooling

`node scripts/product-proxy.mjs` validates the exact product API, shared network
and readiness. `--apply` backs up nginx configuration and routes the existing
Tailscale proxy directly to that API using Docker DNS. This avoids the failed
host-port-443 dependency. Run it after a release changes the API container name.

Product releases now use one controlled command from a clean, synchronized
`main` checkout:

```sh
npm run deploy:product
```

The release controller refuses a SHA that is not the current `origin/main` and
requires successful `verify`, `integration` and `scan` GitHub checks. It enables
Coolify readiness checks, queues the exact commit, waits for the new API to become
ready, switches the stable Tailscale proxy, and atomically rolls the Meta worker
and follow-up worker to the same image. Worker environment is copied through
mode-0600 temporary files, which are deleted automatically. Failed worker startup
restores both previous containers.

Coolify source auto-deploy is disabled by the controller because the native
Dockerfile deployment only replaces the API container and would leave the two
workers on an older image. The controlled command is the supported path from
GitHub to product until all three processes are managed by one Coolify Compose
resource.

## Queue/channel hardening completed by this change set

- Malformed or incomplete Redis jobs move atomically to a dead-letter stream;
  failure to write the dead letter leaves the source pending for recovery.
- Retry append and source acknowledgement are one Lua transaction, so a lost
  Redis response cannot append duplicate retries.
- The worker periodically reclaims abandoned pending entries from dead consumers.
- A renewable per-conversation lease is asserted before commit and each outbound
  send. Lease loss leaves the original queue entry pending for one recovery owner.
- A non-retryable Meta send error goes straight to dead-letter instead of consuming
  the normal retry budget.
- Meta comments use an isolated in-memory episode, do not enter Messenger message
  history, do not cancel follow-ups, and do not advance or refresh the durable
  Messenger state/version/timestamp.
- Every accepted Meta outbound advances its durable cursor before the secondary
  audit write, preventing duplicate customer messages if that audit write fails.
- Operations health exposes both Redis pending and dead-letter counts and raises a
  critical alert when DLQ entries exist or the DLQ key cannot be read.
- GitHub CI now runs real PostgreSQL/Redis integration tests in addition to the
  deterministic unit, lint, typecheck, format and build gates.

Verification remains offline and quota-free: 619 deterministic tests pass, seven
service-backed tests are excluded from the default unit run, and 15 focused
PostgreSQL/Redis/operations integration tests pass against isolated containers.
