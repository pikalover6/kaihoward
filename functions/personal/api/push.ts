export interface Env {
  DB: D1Database
}

// Created lazily so no separate migration run is required.
async function ensureTable(env: Env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        timezone TEXT,
        created_at TEXT NOT NULL
      )`,
    )
    .run()
}

async function readJson(request: Request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: 'Invalid JSON body' }
  }
}

// GET /personal/api/push        -> { count }
// GET /personal/api/push?all=1  -> { subscriptions: [...] }  (used by the reminder Worker)
export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureTable(context.env)
  const url = new URL(context.request.url)

  if (url.searchParams.get('all')) {
    const result = await context.env.DB
      .prepare('SELECT endpoint, p256dh, auth, timezone FROM push_subscriptions')
      .all<{ endpoint: string; p256dh: string; auth: string; timezone: string | null }>()
    return Response.json({ subscriptions: result.results ?? [] })
  }

  const row = await context.env.DB.prepare('SELECT COUNT(*) AS n FROM push_subscriptions').first<{ n: number }>()
  return Response.json({ count: row?.n ?? 0 })
}

// POST { subscription: { endpoint, keys: { p256dh, auth } }, timezone }
export const onRequestPost: PagesFunction<Env> = async (context) => {
  await ensureTable(context.env)
  const parsed = await readJson(context.request)
  if ('error' in parsed) return Response.json({ error: parsed.error }, { status: 400 })

  const input = parsed.body as { subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } }; timezone?: string }
  const sub = input.subscription
  const endpoint = sub?.endpoint
  const p256dh = sub?.keys?.p256dh
  const auth = sub?.keys?.auth

  if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
    return Response.json({ error: 'subscription with endpoint and keys.{p256dh,auth} is required' }, { status: 400 })
  }

  await context.env.DB
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, timezone, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(endpoint) DO UPDATE SET
         p256dh = excluded.p256dh,
         auth = excluded.auth,
         timezone = excluded.timezone`,
    )
    .bind(endpoint, p256dh, auth, typeof input.timezone === 'string' ? input.timezone : null)
    .run()

  return Response.json({ ok: true })
}

// DELETE { endpoint }   (or ?endpoint=)
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  await ensureTable(context.env)
  const url = new URL(context.request.url)
  let endpoint = url.searchParams.get('endpoint') ?? ''
  if (!endpoint) {
    const parsed = await readJson(context.request)
    if (!('error' in parsed)) endpoint = (parsed.body as { endpoint?: string })?.endpoint ?? ''
  }
  if (!endpoint) return Response.json({ error: 'endpoint is required' }, { status: 400 })

  await context.env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(endpoint).run()
  return Response.json({ ok: true })
}
