export interface Env {
  DB: D1Database
}

const MAIN_NOTE_ID = 'main'

async function ensureMainNoteRow(env: Env) {
  await env.DB
    .prepare(`
      INSERT OR IGNORE INTO personal_notes (id, content, updated_at)
      VALUES (?, '', datetime('now'))
    `)
    .bind(MAIN_NOTE_ID)
    .run()
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await ensureMainNoteRow(context.env)

  const row = await context.env.DB
    .prepare('SELECT content FROM personal_notes WHERE id = ?')
    .bind(MAIN_NOTE_ID)
    .first<{ content: string }>()

  return Response.json({ content: row?.content ?? '' })
}

export const onRequestPut: PagesFunction<Env> = async (context) => {
  let body: unknown

  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const content = typeof body === 'object' && body !== null ? (body as { content?: unknown }).content : undefined

  if (typeof content !== 'string') {
    return Response.json({ error: 'content must be a string' }, { status: 400 })
  }

  await context.env.DB
    .prepare(`
      INSERT INTO personal_notes (id, content, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        updated_at = excluded.updated_at
    `)
    .bind(MAIN_NOTE_ID, content)
    .run()

  return Response.json({ ok: true, content })
}
