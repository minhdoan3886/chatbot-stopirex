# Stopirex product hardening — 2026-09-07

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

## Confirmed incident

At 21:37 ICT, the three product application containers run image SHA
`5f9cf7f8621c8a379260a5c7f7447158a198b0d6bf5bac39caed97086719490e`,
release `42bf22484cb092fa757aa7808618cac39fb3833f`.
Direct API readiness reports both PostgreSQL and Redis healthy. Product inbound
pending count is zero and the worker heartbeat is current.

The public endpoint returns 502 because the stable nginx proxy points to
`coolify-proxy`, which could not restart after the host reboot: host TCP port 443
is already in use. An older unused proxy also points to a removed API container.

Staging Redis is a separate incident: its incremental AOF is corrupt. Preserve a
complete copy before any repair. Product Redis is healthy and must not be repaired
or flushed as part of staging recovery.

## Recovery tooling

`node scripts/product-proxy.mjs` validates the exact product API, shared network
and readiness. `--apply` backs up nginx configuration and routes the existing
Tailscale proxy directly to that API using Docker DNS. This avoids the failed
host-port-443 dependency. Run it after a release changes the API container name.

## Work in progress

- Runtime/queue and comment changes from the previous turn are uncommitted and
  still require review, failure-path tests and integration verification.
- They have not been deployed. In particular, the comment isolation change must
  preserve Messenger workflow metadata as well as its runtime state.
- Production release automation and subsequent P1/P2 work remain pending.
