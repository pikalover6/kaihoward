// GET /news/api/:date  — one edition.
// :date is either a YYYY-MM-DD or the literal "today" (returns today's edition,
// falling back to the most recent one so the page is never empty).
// Static routes (archive.ts, generate.ts) take precedence over this dynamic one.
export interface Env {
  DB: D1Database
}

interface ArticleRow {
  id: string
  generated_at: string
  html: string
  summary: string
  summary_json: string | null
}

function payload(row: ArticleRow) {
  let summary: unknown = {}
  if (row.summary_json) {
    try {
      summary = JSON.parse(row.summary_json)
    } catch {
      summary = {}
    }
  }
  return {
    id: row.id,
    date: row.id,
    generated_at: row.generated_at,
    html: row.html,
    summary,
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const date = String(context.params.date)

  let row: ArticleRow | null
  if (date === 'today') {
    const today = new Date().toISOString().slice(0, 10)
    row = await context.env.DB.prepare('SELECT * FROM articles WHERE id = ?')
      .bind(today)
      .first<ArticleRow>()
    if (!row) {
      row = await context.env.DB.prepare(
        'SELECT * FROM articles ORDER BY id DESC LIMIT 1',
      ).first<ArticleRow>()
    }
  } else {
    row = await context.env.DB.prepare('SELECT * FROM articles WHERE id = ?')
      .bind(date)
      .first<ArticleRow>()
  }

  if (!row) {
    return Response.json({ error: 'No edition found' }, { status: 404 })
  }
  return Response.json(payload(row))
}
