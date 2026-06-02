import { buildPushPayload, type PushSubscription } from "@block65/webcrypto-web-push";

// Minimal API client (calls the Access-protected Pages API with the service token).
async function api(env: Env, method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (env.KAI_API_KEY) headers["X-API-Key"] = env.KAI_API_KEY;
  if (env.CF_ACCESS_CLIENT_ID && env.CF_ACCESS_CLIENT_SECRET) {
    headers["CF-Access-Client-Id"] = env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = env.CF_ACCESS_CLIENT_SECRET;
  }
  const base = (env.KAI_BASE_URL || "https://kaihoward.com/personal/api").replace(/\/$/, "");
  const res = await fetch(base + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  if (!res.ok) throw new Error(`API ${method} ${path} -> HTTP ${res.status}`);
  const t = await res.text();
  return t ? JSON.parse(t) : null;
}

type SubRow = { endpoint: string; p256dh: string; auth: string; timezone?: string };

const vapid = (env: Env) => ({ subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY });

const toSub = (r: SubRow): PushSubscription => ({
  endpoint: r.endpoint,
  expirationTime: null,
  keys: { p256dh: r.p256dh, auth: r.auth },
});

async function getSubs(env: Env): Promise<SubRow[]> {
  const d = await api(env, "GET", "/push?all=1");
  return (d?.subscriptions ?? []) as SubRow[];
}

async function sendOne(env: Env, sub: SubRow, notif: { title: string; body: string; url?: string }): Promise<number> {
  const payload = await buildPushPayload(
    {
      data: JSON.stringify({ title: notif.title, body: notif.body, url: notif.url ?? "https://kaihoward.com/personal" }),
      options: { ttl: 600, urgency: "high" },
    },
    toSub(sub),
    vapid(env),
  );
  const res = await fetch(sub.endpoint, { method: payload.method, headers: payload.headers, body: payload.body });
  // Prune dead subscriptions so we stop trying them.
  if (res.status === 404 || res.status === 410) {
    await api(env, "DELETE", "/push", { endpoint: sub.endpoint }).catch(() => {});
  }
  return res.status;
}

export async function sendTest(env: Env): Promise<{ subscriptions: number; statuses: number[] }> {
  const subs = await getSubs(env);
  const statuses: number[] = [];
  for (const s of subs) {
    statuses.push(await sendOne(env, s, { title: "Kai Planner ✅", body: "Test notification — reminders are working." }).catch(() => 0));
  }
  return { subscriptions: subs.length, statuses };
}

// Current wall-clock in a given IANA timezone, as naive parts matching how the
// planner stores start_at/due_date ("YYYY-MM-DDTHH:MM").
function localParts(tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const p: Record<string, string> = {};
  for (const part of fmt.formatToParts(new Date())) p[part.type] = part.value;
  const hour = p.hour === "24" ? "00" : p.hour;
  return { date: `${p.year}-${p.month}-${p.day}`, local: `${p.year}-${p.month}-${p.day}T${hour}:${p.minute}`, hour: Number(hour) };
}

const LEAD_MIN = 10; // remind up to 10 minutes before a scheduled start
const DEDUP_TTL = 3 * 24 * 3600;

const seenKey = (k: string) => "rem:" + k;
const alreadySent = async (env: Env, k: string) => (await env.OAUTH_KV.get(seenKey(k))) !== null;
const markSent = (env: Env, k: string) => env.OAUTH_KV.put(seenKey(k), "1", { expirationTtl: DEDUP_TTL });

export async function runReminders(env: Env): Promise<void> {
  const [goalsRes, subs] = await Promise.all([api(env, "GET", "/goals"), getSubs(env)]);
  const goals = goalsRes?.goals ?? [];
  if (!subs.length || !goals.length) return;

  // Use the most recently subscribed device's timezone as the planner timezone.
  const tz = subs[subs.length - 1].timezone || "America/New_York";
  const { local, date, hour } = localParts(tz);
  const nowMs = Date.parse(local + ":00Z");

  const due: { key: string; notif: { title: string; body: string } }[] = [];
  for (const g of goals) {
    if (g.status === "done") continue;

    if (typeof g.startAt === "string" && g.startAt.length >= 16) {
      const startMs = Date.parse(g.startAt.slice(0, 16) + ":00Z");
      const mins = Math.round((startMs - nowMs) / 60000);
      if (mins >= -1 && mins <= LEAD_MIN) {
        const when = g.startAt.slice(11, 16);
        due.push({
          key: `${g.id}:start:${g.startAt}`,
          notif: { title: `⏰ ${g.title}`, body: mins <= 0 ? `Starting now (${when})` : `Starts in ${mins} min — ${when}` },
        });
      }
    }

    if (typeof g.dueDate === "string" && g.dueDate.slice(0, 10) === date && hour >= 8) {
      due.push({ key: `${g.id}:due:${g.dueDate}`, notif: { title: "📅 Due today", body: g.title } });
    }
  }

  for (const item of due) {
    if (await alreadySent(env, item.key)) continue;
    for (const s of subs) await sendOne(env, s, item.notif).catch(() => {});
    await markSent(env, item.key);
  }
}
