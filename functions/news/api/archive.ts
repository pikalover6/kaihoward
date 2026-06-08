// GET /news/api/archive — list of past editions (date + one-line summary), newest first.
export interface Env {
  DB: D1Database
}

interface Row {
  id: string
  generated_at: string
  summary: string
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { results } = await context.env.DB.prepare(
    'SELECT id, generated_at, summary FROM articles ORDER BY id DESC',
  ).all<Row>()

  return Response.json(
    (results ?? []).map((r) => ({
      date: r.id,
      generated_at: r.generated_at,
      summary: r.summary ?? '',
    })),
  )
}
