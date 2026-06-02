import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { z } from "zod";
import { GitHubHandler } from "./github-handler";
import { runReminders, sendTest } from "./reminders";

// Auth context produced by the GitHub OAuth flow, available as this.props.
type Props = {
  login: string;
  name: string;
  email: string;
  accessToken: string;
};

// Only these GitHub logins get the planner tools.
const ALLOWED_USERNAMES = new Set<string>(["pikalover6"]);

const STATUSES = ["planned", "active", "blocked", "done"] as const;

const SERVER_INSTRUCTIONS =
  "This is 'Kai Planner' — Kai's personal productivity center at kaihoward.com/personal, and the source of truth " +
  "for Kai's schedule, goals, tasks, deadlines, plans, and a freeform note. Whenever Kai asks about their schedule, " +
  "plans, goals, or to-dos, or asks to add / change / reschedule / prioritize / rearrange / organize / plan anything, " +
  "USE THESE TOOLS by default — do not search files or Google Drive and do not ask Kai to paste documents. For " +
  "open-ended questions start with get_overview or get_schedule, then drill in with list_goals / search_goals.";

/* --------------------------------------------------------------- API client --- */

async function api(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.KAI_API_KEY) headers["X-API-Key"] = env.KAI_API_KEY;
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  const base = (env.KAI_BASE_URL || "https://kaihoward.com/personal/api").replace(/\/$/, "");

  let res: Response;
  try {
    res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
  } catch (e: any) {
    throw new Error(`Network error ${method} ${path}: ${e.message}`);
  }

  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `Request to ${path} was redirected (HTTP ${res.status}) - Cloudflare Access blocked it. ` +
        `Check the CF Access service-token secrets on this Worker.`,
    );
  }

  const t = await res.text();
  let data: any = null;
  if (t) {
    try {
      data = JSON.parse(t);
    } catch {
      data = t;
    }
  }

  if (!res.ok) {
    const detail = typeof data === "string" ? data : JSON.stringify(data);
    if (res.status === 401) throw new Error(`Unauthorized (401) on ${path}; check KAI_API_KEY.`);
    throw new Error(`API ${method} ${path} failed: HTTP ${res.status}. ${String(detail).slice(0, 500)}`);
  }
  return data;
}

const fetchGoals = async (env: Env): Promise<any[]> => (await api(env, "GET", "/goals")).goals || [];

/* ----------------------------------------------------------------- helpers --- */

function todayLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  return m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : null;
}

function buildTree(goals: any[]): any[] {
  const byId = new Map(goals.map((g) => [g.id, { ...g, children: [] as any[] }]));
  const roots: any[] = [];
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sortRec = (nodes: any[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || String(a.title).localeCompare(String(b.title)));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

function descendantIds(goals: any[], id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop();
    for (const g of goals) {
      if (g.parentId === cur && !seen.has(g.id)) {
        seen.add(g.id);
        out.push(g.id);
        stack.push(g.id);
      }
    }
  }
  return out;
}

function summarize(g: any) {
  return {
    id: g.id,
    title: g.title,
    status: g.status,
    priority: g.priority,
    startAt: g.startAt || null,
    endAt: g.endAt || null,
    dueDate: g.dueDate || null,
    durationLabel: g.durationLabel || null,
    parentId: g.parentId || null,
  };
}

const GOAL_FIELDS = [
  "parentId", "title", "description", "durationLabel", "status", "priority",
  "startDate", "dueDate", "startAt", "endAt", "sortOrder", "x", "y", "collapsed",
];

function pickGoalFields(args: Record<string, any>, includeId = false): Record<string, any> {
  const body: Record<string, any> = {};
  if (includeId) body.id = args.id;
  for (const k of GOAL_FIELDS) if (args[k] !== undefined) body[k] = args[k];
  return body;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };
const ok = (data: any): ToolResult => ({
  content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
});
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: `Error: ${message}` }], isError: true });

// Wrap a handler so thrown errors come back as an isError tool result.
function guard(fn: () => Promise<any>): Promise<ToolResult> {
  return fn().then(ok).catch((e: any) => fail(e?.message ?? String(e)));
}

/* ------------------------------------------------------------------- agent --- */

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
  server = new McpServer(
    { name: "kai-planner", version: "1.1.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  async init() {
    // Gate the whole toolset on the GitHub identity.
    if (!this.props || !ALLOWED_USERNAMES.has(this.props.login)) return;

    const env = this.env;

    this.server.tool(
      "get_overview",
      "Catch-up snapshot of the whole planner: counts by status, today's items, and the scratch note. Use first for open-ended questions like \"what's on my plate\".",
      {},
      () =>
        guard(async () => {
          const [goals, note] = await Promise.all([fetchGoals(env), api(env, "GET", "/note")]);
          const today = todayLocal();
          const counts: Record<string, number> = { planned: 0, active: 0, blocked: 0, done: 0 };
          for (const g of goals) counts[g.status] = (counts[g.status] || 0) + 1;
          const todays = goals
            .filter((g) => normDay(g.startAt) === today || normDay(g.dueDate) === today)
            .sort((a, b) => String(a.startAt ?? "99").localeCompare(String(b.startAt ?? "99")));
          return { date: today, totals: { goals: goals.length, ...counts }, today: todays.map(summarize), note: note?.content ?? "" };
        }),
    );

    this.server.tool(
      "list_goals",
      "List planner goals/tasks as a nested tree (default) or flat list. Optionally filter by status or restrict to a parent's children. Source of truth for IDs.",
      {
        status: z.enum(STATUSES).optional(),
        parentId: z.string().optional(),
        view: z.enum(["tree", "flat"]).optional(),
      },
      (args) =>
        guard(async () => {
          let goals = await fetchGoals(env);
          if (args.parentId) goals = goals.filter((g) => g.parentId === args.parentId);
          if (args.status) goals = goals.filter((g) => g.status === args.status);
          return args.view === "flat" ? { count: goals.length, goals } : { count: goals.length, tree: buildTree(goals) };
        }),
    );

    this.server.tool(
      "get_schedule",
      'Items whose scheduled time (startAt) or due date falls in [from, to], sorted by time. Dates are YYYY-MM-DD; defaults to today. Use for "what\'s my schedule today/this week".',
      { from: z.string().optional(), to: z.string().optional() },
      (args) =>
        guard(async () => {
          const from = normDay(args.from) || todayLocal();
          const to = normDay(args.to) || from;
          const goals = await fetchGoals(env);
          const inRange = (d: string | null) => !!d && d >= from && d <= to;
          const items = goals
            .filter((g) => inRange(normDay(g.startAt)) || inRange(normDay(g.dueDate)))
            .sort((a, b) => String(a.startAt ?? a.dueDate ?? "99").localeCompare(String(b.startAt ?? b.dueDate ?? "99")));
          return { from, to, count: items.length, items: items.map(summarize) };
        }),
    );

    this.server.tool(
      "search_goals",
      "Find goals whose title or description contains the query (case-insensitive). Use to locate an item before editing.",
      { query: z.string() },
      (args) =>
        guard(async () => {
          const q = String(args.query || "").toLowerCase();
          const goals = await fetchGoals(env);
          const matches = goals.filter(
            (g) => String(g.title).toLowerCase().includes(q) || String(g.description).toLowerCase().includes(q),
          );
          return { query: args.query, count: matches.length, matches: matches.map(summarize) };
        }),
    );

    this.server.tool(
      "create_goal",
      'Create a goal/task/event. Only title is required. Nest with parentId; schedule with startAt/endAt ("YYYY-MM-DDTHH:MM"); deadline with dueDate ("YYYY-MM-DD"); durationLabel is free text.',
      {
        title: z.string(),
        description: z.string().optional(),
        parentId: z.string().optional(),
        durationLabel: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        priority: z.number().int().min(1).max(5).optional(),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
      },
      (args) => guard(async () => ({ created: (await api(env, "POST", "/goals", pickGoalFields(args))).goal })),
    );

    this.server.tool(
      "update_goal",
      'Edit a goal by id; pass only fields to change. Rename, reschedule (startAt/endAt/dueDate), reprioritize, change status, edit description. Pass "" to clear a date field.',
      {
        id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        parentId: z.string().optional(),
        durationLabel: z.string().optional(),
        status: z.enum(STATUSES).optional(),
        priority: z.number().int().min(1).max(5).optional(),
        startDate: z.string().optional(),
        dueDate: z.string().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        sortOrder: z.number().int().optional(),
        collapsed: z.boolean().optional(),
      },
      (args) => guard(async () => ({ updated: (await api(env, "PATCH", "/goals", pickGoalFields(args, true))).goal })),
    );

    this.server.tool(
      "complete_goal",
      "Mark a goal done (or reopen as active with done=false).",
      { id: z.string(), done: z.boolean().optional() },
      (args) =>
        guard(async () => ({
          updated: (await api(env, "PATCH", "/goals", { id: args.id, status: args.done === false ? "active" : "done" })).goal,
        })),
    );

    this.server.tool(
      "move_goal",
      'Re-nest a goal under a different parent (rearrange the hierarchy). newParentId null/"" moves it to top level. Optional sortOrder positions it among siblings. Cycle-safe.',
      { id: z.string(), newParentId: z.string().nullable().optional(), sortOrder: z.number().int().optional() },
      (args) =>
        guard(async () => {
          const goals = await fetchGoals(env);
          if (!goals.find((g) => g.id === args.id)) throw new Error(`Goal not found: ${args.id}`);
          const target = args.newParentId == null ? "" : String(args.newParentId);
          if (target) {
            if (target === args.id) throw new Error("A goal cannot be its own parent.");
            if (!goals.find((g) => g.id === target)) throw new Error(`Target parent not found: ${target}`);
            if (descendantIds(goals, args.id).includes(target))
              throw new Error("Cannot move a goal under one of its own descendants (would create a cycle).");
          }
          const body: Record<string, any> = { id: args.id, parentId: target };
          if (typeof args.sortOrder === "number") body.sortOrder = args.sortOrder;
          return { moved: (await api(env, "PATCH", "/goals", body)).goal };
        }),
    );

    this.server.tool(
      "reorder_goals",
      "Set the explicit order of sibling goals: each id in orderedIds gets an increasing sortOrder.",
      { orderedIds: z.array(z.string()) },
      (args) =>
        guard(async () => {
          const results = [];
          for (let i = 0; i < args.orderedIds.length; i++) {
            const r = await api(env, "PATCH", "/goals", { id: args.orderedIds[i], sortOrder: i * 10 });
            results.push(r.goal && { id: r.goal.id, title: r.goal.title, sortOrder: r.goal.sortOrder });
          }
          return { reordered: results };
        }),
    );

    this.server.tool(
      "delete_goal",
      "Delete a goal and ALL its descendants (the whole branch). Cannot be undone — confirm for anything non-trivial.",
      { id: z.string() },
      (args) =>
        guard(async () => {
          const goals = await fetchGoals(env);
          const removed = [args.id, ...descendantIds(goals, args.id)];
          await api(env, "DELETE", `/goals?id=${encodeURIComponent(args.id)}`);
          return { ok: true, deletedIds: removed, deletedCount: removed.length };
        }),
    );

    this.server.tool("get_note", "Read the planner scratch note.", {}, () =>
      guard(async () => ({ content: (await api(env, "GET", "/note")).content ?? "" })),
    );

    this.server.tool(
      "update_note",
      "Replace the entire planner scratch note. Overwrites existing content — read it first with get_note to append.",
      { content: z.string() },
      (args) =>
        guard(async () => {
          await api(env, "PUT", "/note", { content: String(args.content ?? "") });
          return { ok: true };
        }),
    );
  }
}

const oauthProvider = new OAuthProvider({
  apiHandler: MyMCP.serve("/mcp") as any,
  apiRoute: "/mcp",
  authorizeEndpoint: "/authorize",
  clientRegistrationEndpoint: "/register",
  defaultHandler: GitHubHandler as any,
  tokenEndpoint: "/token",
});

// Wrap the OAuth handler so the same Worker can also serve a key-guarded
// test-push endpoint and run the reminder cron.
export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const url = new URL(request.url);
    if (url.pathname === "/internal/send-test") {
      if (url.searchParams.get("key") !== env.KAI_API_KEY) return new Response("forbidden", { status: 403 });
      return sendTest(env)
        .then((r) => Response.json(r))
        .catch((e: any) => Response.json({ error: String(e?.message ?? e) }, { status: 500 }));
    }
    return (oauthProvider as any).fetch(request, env, ctx);
  },
  scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(runReminders(env));
  },
};
