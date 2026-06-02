# kaihoward.com — project context

Context for Claude Code sessions/agents working on this repo. Written May 2026.

## What this is

`kaihoward.com` is Kai Howard's personal site (React/Vite, hosted on **Cloudflare
Pages**). The interesting part is **kaihoward.com/personal** — a personal
productivity center / planner ("advanced planner"): a hierarchical tree of
goals/tasks/plans with a canvas (graph) view, a calendar, scheduled time blocks,
and a scratch note. Kai drives it both from the web UI and **from Claude** (Desktop)
via an MCP connector, e.g. "what's on my schedule today", "add a 9am workout",
"move X under Y", "mark Z done".

- **Repo:** github.com/pikalover6/kaihoward (public). Default branch **`main`**.
- **Deploy:** push to `main` → Cloudflare Pages auto-builds & deploys to
  kaihoward.com. (Pages project name: `kaihoward`, build output `dist`.)
- **Stack:** React 19 + Vite (`src/`), Cloudflare Pages Functions (`functions/`,
  TypeScript), Cloudflare **D1** (SQLite) for storage, plain CSS.

## Layout

```
src/pages/PersonalPage.jsx   the /personal UI (canvas + calendar + inspector)
functions/personal/api/      the API (Pages Functions), all under /personal/api/*
  _middleware.ts             auth (API key OR Cloudflare Access) + CORS
  goals.ts                   GET/POST/PATCH/DELETE goals
  note.ts                    GET/PUT the single scratch note
migrations/                  D1 migrations 0001..0005 (wrangler-tracked)
mcp/                         the Claude connector (see "MCP connector" below)
wrangler.toml                D1 binding (DB) + Pages config
```

## Data model (D1 database `kai-personal-db`)

- **`life_goals`** — the planner tree. Columns: `id`, `parent_id` (tree;
  `ON DELETE CASCADE`), `title`, `description`, `horizon`, `duration_label`
  (free text like "45 min"), `status` (`planned|active|blocked|done`), `priority`
  (1–5), `start_date`, `due_date` (date-only deadline), `sort_order`, `x`/`y`
  (canvas position), `collapsed`, **`start_at`/`end_at`** (ISO local datetime
  `YYYY-MM-DDTHH:MM` calendar blocks — migration 0005), `created_at`, `updated_at`.
  API returns camelCase (`parentId`, `dueDate`, `startAt`, …).
- **`personal_notes`** — one row, id `main`, `content`.

## API (`/personal/api/*`)

- `GET /goals` → `{ goals: [...] }` (all). `POST /goals` (create, only `title`
  required). `PATCH /goals` (`{id, ...fields}`; `parentId:""` moves to top level;
  send `""` to clear a date). `DELETE /goals?id=` (cascades).
- `GET /note` / `PUT /note` `{content}`.
- **Auth (`_middleware.ts`):** request passes if it carries the `API_KEY` (header
  `X-API-Key` or `Authorization: Bearer`) **OR** a valid Cloudflare Access JWT.

## Cloudflare Access (important!)

`/personal*` is behind **Cloudflare Access** (Zero Trust team
`divine-cloud-2fa3.cloudflareaccess.com`). A human with SSO (Kai's email) gets in;
the UI's same-origin fetches ride that session. For **programmatic/Claude access**
there's an Access **service token** ("kai-planner-mcp") allowed by a `non_identity`
policy on the "Kai personal dashboard" app (`kaihoward.com/personal*`). The
connector sends `CF-Access-Client-Id` + `CF-Access-Client-Secret` (plus the API
key). Without those headers the API 302-redirects to a login page.
> There's a stray, harmless Access app "Kai personal API" pointed at the wrong path
> `/api/personal/*` (note the reversed segments) — it guards nothing.

## MCP connector (`mcp/`) — how Claude edits the planner

`mcp/kai-planner-mcp.mjs` is a **zero-dependency Node MCP stdio server** (newline-
delimited JSON-RPC 2.0; needs Node 18+ for global `fetch`). It exposes 12 tools:
`get_overview, list_goals, get_schedule, search_goals, create_goal, update_goal,
complete_goal, move_goal, reorder_goals, delete_goal, get_note, update_note`. It
calls the API with the API key + CF Access service-token headers, and returns a
`SERVER_INSTRUCTIONS` string in `initialize` so the model knows to use it by default.

It reads config from env: `KAI_BASE_URL` (default `https://kaihoward.com/personal/api`),
`KAI_API_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`.

**Desktop integration — key gotcha:** the current Claude Desktop build (the newer
"Claude" app) does **NOT** load local servers from `claude_desktop_config.json` —
it strips `mcpServers` on startup. It installs local connectors as **Desktop
Extensions (`.mcpb`)**. So the connector ships as `mcp/kai-planner.mcpb`
(built from `mcp/extension/`, which bundles `manifest.json` + a copy of the server).
Install via **Settings → Extensions → Advanced settings → Extension Developer →
Install Extension…**; it prompts for the secrets (stored in the OS keychain).
- Rebuild after editing the server: `cp mcp/kai-planner-mcp.mjs mcp/extension/server/`
  then `npx -y @anthropic-ai/mcpb pack mcp/extension mcp/kai-planner.mcpb`.
- `mcp/install.mjs` is the *other* path (Claude Code CLI, or older Desktop): it
  writes `mcpServers` into the right config (auto-detects the Windows MSIX/Store
  path `…\Packages\Claude_*\LocalCache\Roaming\Claude\`). `mcp/README.md` has the
  cross-machine setup; `mcp/smoke-test.mjs` is a live end-to-end test.
- To make Claude *prefer* the planner in every chat, Kai also adds a line to Claude's
  account-level personal preferences (Settings → Profile).

## Key IDs (non-secret)

- CF account `1746f2a135e716d08fbe52452a173a31`, zone `e73bc5f8c3bda3bdf4a817072765bdf9`
- D1 `kai-personal-db` id `7d9dee28-9595-460d-b48c-3d1b5bb0540d` (binding `DB`)
- Access dashboard app `25cc34c5-c062-4d6e-823b-a5964b878eab`; service token
  client id `c726a49ad372081ea5a9522291c9192e.access`

## Secrets (NOT in this repo)

- `API_KEY` — set as a Cloudflare Pages secret (production + preview) and held by
  the connector as `KAI_API_KEY`. Ask Kai / password manager.
- `CF_ACCESS_CLIENT_SECRET` — the Access service-token secret (shown once at
  creation). Ask Kai.
- To run admin tasks (D1 migrations, Pages secrets, Access changes) you need a
  Cloudflare API token from Kai (wrangler is not logged in). The CF REST API is
  `https://api.cloudflare.com/client/v4`.

## Working on it

- Frontend: `npm install` then `npm run dev` / `npm run build` / `npm run lint`.
- DB changes: add a `migrations/000N_*.sql`; apply to prod D1 via the CF D1 query
  API (or `wrangler d1 migrations apply` once authed) and record it in
  `d1_migrations`. Migrations are tracked through 0005.
- Deploy = commit to `main` and push; Pages builds automatically. Verify the live
  API with the service token + API key, and/or run `node mcp/smoke-test.mjs`
  (set `KAI_API_KEY`, `CF_ACCESS_CLIENT_ID`, `CF_ACCESS_CLIENT_SECRET`).
- Keep secrets out of committed files (this repo is public).

## Remote MCP server (`mcp-remote/`) — Claude on phone/web/desktop

A Cloudflare **Worker** (`kai-planner-mcp`, based on Cloudflare's
remote-mcp-github-oauth template: `@cloudflare/workers-oauth-provider` + `agents`
McpAgent) serving the same 12 tools over Streamable HTTP at
`https://kai-planner-mcp.pikalover666666.workers.dev/mcp`. Auth = **GitHub OAuth**
(OAuth app client id `Ov23lim1wZwfDZ1HZD6z`, allowlisted to login `pikalover6` in
`src/index.ts`). Tools call `/personal/api` with the service token (so no D1
binding). Bindings: Durable Object `MCP_OBJECT` (MyMCP), KV `OAUTH_KV`
(`798136fe663d4ebcaef6b73161931761`, also used for reminder de-dup). Add it in
Claude at **Customize → Connectors → Add custom connector** (the `/mcp` URL); leave
the OAuth fields blank (dynamic client registration). Configured on web → syncs to
mobile. Deploy: `cd mcp-remote && npx wrangler deploy` (needs a CF token with
Workers Scripts + KV edit). Worker secrets: `GITHUB_CLIENT_ID/SECRET`,
`COOKIE_ENCRYPTION_KEY`, `KAI_API_KEY`, `CF_ACCESS_CLIENT_ID/SECRET`,
`VAPID_PRIVATE_KEY`.

## Web-push reminders (Phase B)

- Frontend PWA: `public/manifest.webmanifest`, `public/sw.js` (push +
  notificationclick), icons (`scripts/gen-icons.mjs`), PWA tags in `index.html`,
  and `src/PushControls.jsx` (Enable reminders → subscribe, stores
  subscription+timezone). iOS needs Add-to-Home-Screen to allow push.
- API: `functions/personal/api/push.ts` stores/lists/deletes subscriptions in
  D1 `push_subscriptions` (lazy `CREATE TABLE`; migration 0006). `?all=1` lists
  them for the Worker.
- Sender: the same Worker's `scheduled()` cron (`* * * * *`, `src/reminders.ts`)
  sends web push for upcoming `start_at` (≤10 min before) and due-today items,
  timezone from the latest subscription, de-dup keys `rem:*` in KV. VAPID public
  key is in `wrangler.jsonc` vars + `PushControls.jsx`; private key is a secret.
  Manual test: `POST /internal/send-test?key=<KAI_API_KEY>`.
