// POST /news/api/generate — store/replace an edition. Called by n8n (or the
// generator script). PROTECTED: requires the same API_KEY used by /personal,
// via `X-API-Key` or `Authorization: Bearer`. Reads are public; writes are not.
export interface Env {
  DB: D1Database
  API_KEY?: string
}

interface Body {
  date?: string
  html?: unknown
  summary?: unknown
}

function extractApiKey(request: Request): string | null {
  const x = request.headers.get('X-API-Key')
  if (x) return x
  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return null
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const configured = context.env.API_KEY
  if (!configured || extractApiKey(context.request) !== configured) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: Body
  try {
    body = (await context.request.json()) as Body
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body.html !== 'string' || !body.html.trim()) {
    return Response.json({ error: 'html must be a non-empty string' }, { status: 400 })
  }

  const date = typeof body.date === 'string' ? body.date : new Date().toISOString().slice(0, 10)
  // summary may be a structured object or a bare string; derive both columns.
  let summaryLine = ''
  let summaryJson = '{}'
  if (typeof body.summary === 'string') {
    summaryLine = body.summary
    summaryJson = JSON.stringify({ summary: body.summary })
  } else if (body.summary && typeof body.summary === 'object') {
    summaryJson = JSON.stringify(body.summary)
    const s = (body.summary as { summary?: unknown }).summary
    summaryLine = typeof s === 'string' ? s : ''
  }

  await context.env.DB.prepare(
    `INSERT INTO articles (id, generated_at, html, summary, summary_json, created_at, updated_at)
     VALUES (?, datetime('now'), ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       generated_at = datetime('now'),
       html = excluded.html,
       summary = excluded.summary,
       summary_json = excluded.summary_json,
       updated_at = datetime('now')`,
  )
    .bind(date, body.html, summaryLine, summaryJson)
    .run()

  return Response.json({ ok: true, date })
}
