# InteraOne - Project Context for AI Assistants

## Project Overview
InteraOne is a multi-tenant customer support platform built as a **Turborepo + pnpm monorepo**. Visitors chat through an embeddable widget, an AI agent answers first (grounded in the organization's knowledge base and able to call tools), and conversations escalate to human agents when needed. Around that core it also has tickets, CRM (contacts, accounts, deals, leads, lead sources), email/WhatsApp/Telegram channels, integrations and custom actions, analytics, and **Threads** (a public help/community portal served on customer domains).

### Deployment Models
- **Self-hosted (OSS)**: run the whole stack with Docker (`docker/docker-compose.yml`, fronted by Caddy).
- **Managed cloud**: the same code run multi-tenant, with billing turned on.

The mode is chosen by `INTERAONE_MODE` (`self-host` default, or `cloud`) in the gateway, mirrored by `VITE_INTERAONE_MODE` in the console.

### Open Core (`ee/`)
`ee/` holds Enterprise Edition code under a commercial license (`ee/LICENSE`); currently that is **billing** (Dodo Payments checkout and webhooks). It is plain JS loaded at runtime (no build step) by `apps/gateway/src/shared/ee/loader/`, which validates its exported `contractVersion`. Feature availability is decided by `apps/gateway/src/shared/ee/licensing/` (plan tiers `free | pro | proplus`, per-plan limits, and which modes each EE feature runs in; billing is `cloud` only). The console mirrors this in `apps/console/src/shared/ee/` and `ee-feature-gate.tsx`.

## Apps

| App | Stack | Role | Dev port |
|---|---|---|---|
| `apps/gateway` | Express, Mongoose, Socket.IO, BullMQ | The API and real-time hub. **The only app that talks to MongoDB.** | 3002 |
| `apps/console` | Vite, React 19, React Router 7, TanStack Query, Zustand, Tailwind v4 | Admin + agent dashboard, and the Threads portal UI | 5173 |
| `apps/agent` | Node, BullMQ, ioredis, Qdrant, LLM SDKs | AI worker: chat replies, agent assist, conversation analysis, knowledge ingestion | 4010 (health) |
| `apps/worker` | Node, BullMQ, Mongoose | Platform background jobs: email, analytics, lead-source ingestion, subscription expiry | - |
| `apps/launcher` | Vite | The embeddable chat widget, built and uploaded to Silo | served from Silo :9001 |

`packages/` only holds shared eslint and TypeScript configs.

## How the pieces talk

```
Widget / Console ──Socket.IO + REST──▶ Gateway ──▶ MongoDB
                                         │
                       BullMQ (Redis) ───┼──▶ agent   (ai-processing, assist-processing,
                                         │             conversation-analyzer, document-ingestion,
                                         │             ai-observability)
                                         └──▶ worker  (platform-email, platform-analytics,
                                                       lead-source-ingestion, subscription-expiry)
Agent ──Redis pub/sub──▶ Gateway: "ai:stream" (tokens), "ai:response" (final), "assist:response"
Agent ──HTTP internal API (header x-ai-tool-secret)──▶ Gateway, for every data read/write
```

- **Agent has no database access.** It reads and writes through the gateway's internal endpoints (`apps/agent/src/infrastructure/api/`). The shared secret `AI_TOOL_SECRET` must be identical in `apps/gateway/.env` and `apps/agent/.env`; if not, the agent's calls get 401s. The two `.env.example` files ship with different values, so fix this after `make copy-env`.
- **Chat reply flow**: `sockets/handlers/widget.handler.ts` saves the visitor message, and if the conversation is not assigned, escalated, human-joined, resolved or closed, enqueues `ai-processing`. `apps/agent/src/workers/chat-reply.worker.ts` runs `modules/chat/pipelines/run-pipeline.ts`: pre-checks (gates, subscription, OTP, FAQ fast path) → build context (history + Qdrant retrieval) → LLM with tool loop and provider fallback (`FallbackRouter`) → publish to Redis. `sockets/consumers/ai-response.consumer.ts` relays to the widget and console.
- **Escalation**: the `escalate-to-human` tool (or a pipeline rule) calls the gateway, which flags the conversation; later messages then skip the AI queue.
- **Socket rooms**: `org:{orgId}`, `user:{userId}`, `conversation:{conversationId}` (and `org:{orgId}:conv:{conversationId}`).

## Gateway (`apps/gateway/src`)

```
index.ts
modules/<feature>/       # feature modules, each: *.controller.ts, *.routes.ts, *.schema.ts (validation),
                         #   *.service.ts, *.types.ts, index.ts
shared/
  core/                  # errors, logger (Winston), response helpers, types
  infra/                 # config, database, redis, queue (BullMQ queues), silo (MinIO), swagger
  models/                # all Mongoose models (one file each)
  security/              # auth (JWT), middleware (auth, validation, error handler, roles), credential-cipher
  ee/                    # EE loader, licensing/entitlements, audit
  queues/, utils/, seeds/
sockets/
  handlers/              # widget + agent socket events
  consumers/             # Redis pub/sub consumers from the agent
```

Path aliases: `@shared/*`, `@shared/ee`, `@modules/*`, `@sockets/*`.

Modules: accounts, agent, analytics, auth, channels, contacts, conversation, crm-records, custom-actions, deals, email, integrations, knowledge, lead-sources, leads, membership, notification, observability, organization, storage, templates, threads, tickets, widget.

Key patterns: controllers stay thin and delegate to services; middleware chain is `authenticate` → `resolveOrganization` → `requireRole(...)` → validation → controller (all in `shared/security/middleware/`, alongside `authenticateWidget`, `ai-secret`, `rate-limit`, `ee`); every query is scoped by `organizationId`.

## Agent (`apps/agent/src`)

- `workers/`: one BullMQ worker per queue (chat-reply, agent-assist, conversation-analysis, knowledge-ingestion, observability).
- `modules/chat/`: the reply pipeline. `modules/assist/`: suggest reply, draft, generate note. `modules/ingestion/`: PDF/DOCX/URL/text → embeddings → Qdrant. `modules/agents/`: the tool loop and `tools/` (knowledge and FAQ retrieval, tickets, contact profile, email, OTP, escalation, web crawl, custom actions, Composio sessions, and more).
- `infrastructure/providers/`: LLM providers (OpenAI, Bedrock, Ollama, HuggingFace) behind a registry, factory and fallback routing. Chosen by `LLM_PROVIDER` and `EMBEDDING_PROVIDER` in `.env`.
- `infrastructure/vector/` (Qdrant), `cache/`, `queue/` (publishing replies), `storage/` (Silo/MinIO).

## Console (`apps/console/src`)

```
main.tsx, App.tsx
router/index.tsx         # React Router routes
domains/<feature>/       # accounts, agent, auth, billing, channels, contacts, conversation, crm,
                         #   custom-actions, dashboard, integrations, knowledge, member, settings,
                         #   threads, tickets, widget
shared/
  ui/                    # shadcn-style primitives (button, card, dialog, input, loader, select, tabs, ...)
  components/            # org-switcher, protected-route, ee-feature-gate, upgrade-modal, ...
  hooks/, lib/, layouts/, theme/, types/, ee/, tours/
```

Data fetching uses TanStack Query; client state uses Zustand. Env vars are `VITE_API_URL`, `VITE_SOCKET_URL`, `VITE_WIDGET_URL`, `VITE_PUBLIC_ENV`, `VITE_INTERAONE_MODE`.

## Data model (gateway `shared/models`)

- **Tenancy**: `Organization`, `User` (global identity, no global role), `Membership` (user ↔ org with role `owner | admin | agent`).
- **Support**: `Conversation`, `Message`, `Widget` (embed config and AI settings), `Channel` (email/WhatsApp/Telegram), `Ticket`, `Notification`, `UnansweredQuestion`.
- **CRM**: `Contact`, `ContactConflict`, `Account`, `CrmRecord`, `SalesPipeline`, `LeadSourceConnection`, `LeadSourceForm`, `LeadSubmission`, `FacebookOAuthState`.
- **Knowledge**: `Knowledge` (sources ingested into Qdrant).
- **Integrations / actions**: `IntegrationConnection`, `IntegrationSession`, `IntegrationPolicy`, `IntegrationApproval`, `IntegrationExecution`, `IntegrationAuditEvent`, `CustomAction`, `CustomActionIntegration`, `CustomActionApproval`.
- **Threads**: `ThreadDomain` (customer domains, DNS/TLS verification).
- **Templates**: `Template`, `EmailTemplate`.
- **Billing / usage**: `BillingSubscription`, `BillingCheckoutIntent`, `BillingWebhookEvent` (idempotency), `UsageRecord`.
- **Other**: `SystemEvent`.

All tenant data carries `organizationId`, and Redis keys are namespaced `org:{orgId}:...`.

## Auth & roles
- Login returns the user's memberships; with more than one, the console sends them to `/select-org`. The JWT (access + refresh) carries the selected `organizationId` and `orgRole`.
- Roles per organization: **owner** (billing, deactivation), **admin** (settings, widget, members; cannot demote owners), **agent** (inbox). Visitors use the widget.
- Console guards routes with `shared/components/protected-route.tsx`.

## API conventions
Response shape:
```typescript
{ success: boolean; message?: string; data?: any; error?: string }
```
Validate input with the module's `*.schema.ts` + validation middleware, use try/catch and the centralized error handler, log with the Winston logger, return proper status codes.

## Design system (console)
- Light and dark themes, defined as CSS variables in `apps/console/src/index.css` and switched by `shared/theme/`. Primary is a mauve (`#523744` light, `#845c6c` dark). Always use the tokens, never hard-coded colors.
- Use primitives from `shared/ui/`; show `loader.tsx` / `Spinner.tsx` during async work.
- Navigation uses React Router's `<Link>`, not `<a>`, for internal routes.
- `cursor-pointer` on clickable elements, `cursor-text` on inputs.

## Local development

Requirements: Node **>= 22.22.3** (gateway `engines`), pnpm 9.15, Docker.

```bash
make all            # verify → check-docker → copy-env → install → docker-start → widget-deploy → dev
make docker-start   # infra only
make dev            # pnpm run dev (turbo: gateway, console, agent, worker; launcher excluded)
make docker-stop
make help           # all targets
```

Dev infra (`docker/docker-compose.dev.yml`): MongoDB 27017 (admin/dev123), Mongo Express 8081, Redis 6379 (password dev123), MailHog 1025 SMTP / 8025 UI, Qdrant 6333/6334, Silo (MinIO) 9001 API / 9002 console, log viewer.

Env files: `make copy-env` creates `apps/<app>/.env` from each `.env.example`. After that, set `AI_TOOL_SECRET` to the same value in gateway and agent, and add an LLM provider key (for example `OPENAI_API_KEY`) in the agent for AI replies.

Production stack (`docker/docker-compose.yml`): caddy, gateway, console, agent, worker, launcher-deploy, mongodb, redis, silo, qdrant, log-viewer. See `docs/threads-domains.md` for custom-domain TLS setup.

## Testing & checks
```bash
pnpm run check-types
pnpm run lint
pnpm --filter @InteraOne/gateway test   # vitest, tests in apps/gateway/tests
pnpm --filter @InteraOne/agent test     # vitest, tests in apps/agent/tests
```

## Key conventions
1. TypeScript strict; avoid `any`.
2. Scope every query, cache key, socket room and vector search by `organizationId`.
3. Keep controllers thin; business logic lives in services.
4. Only the gateway touches MongoDB; other apps go through its API or queues.
5. Heavy or slow work goes on a BullMQ queue, not in the request path.
6. Validate all client and socket input.
7. Use theme tokens and `shared/ui` primitives in the console.
8. Comment the "why", not the "what".
