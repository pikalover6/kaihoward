export interface Env {
  DB: D1Database
}

type GoalRow = {
  id: string
  parent_id: string | null
  title: string
  description: string
  horizon: string
  status: string
  priority: number
  start_date: string | null
  due_date: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

const HORIZONS = new Set(['life', 'five-year', 'year', 'semester', 'month', 'week', 'day', 'minute'])
const STATUSES = new Set(['planned', 'active', 'blocked', 'done'])
const STARTER_GOALS = [
  {
    id: 'starter-law',
    parentId: null,
    title: 'Graduate law school',
    description: 'The long-range objective that every class, habit, exam, application, and daily work block can ladder into.',
    horizon: 'life',
    status: 'active',
    priority: 5,
    sortOrder: 0,
  },
  {
    id: 'starter-undergrad',
    parentId: 'starter-law',
    title: 'Finish undergrad with target GPA',
    description: 'Keep grades, recommendations, transcript strength, and application readiness moving together.',
    horizon: 'five-year',
    status: 'active',
    priority: 5,
    sortOrder: 1,
  },
  {
    id: 'starter-semester',
    parentId: 'starter-undergrad',
    title: 'Win this semester',
    description: 'Map every syllabus into exams, papers, reading blocks, office hours, and recovery time.',
    horizon: 'semester',
    status: 'planned',
    priority: 4,
    sortOrder: 2,
  },
  {
    id: 'starter-week',
    parentId: 'starter-semester',
    title: 'Build next week plan',
    description: 'Convert the semester plan into calendar blocks and a realistic task stack.',
    horizon: 'week',
    status: 'planned',
    priority: 3,
    sortOrder: 3,
  },
]

function toGoal(row: GoalRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    horizon: row.horizon,
    status: row.status,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function normalizeGoalInput(body: unknown) {
  if (typeof body !== 'object' || body === null) {
    return { error: 'JSON body must be an object' }
  }

  const input = body as Record<string, unknown>
  const title = typeof input.title === 'string' ? input.title.trim() : ''

  if (!title) {
    return { error: 'title is required' }
  }

  const horizon = typeof input.horizon === 'string' && HORIZONS.has(input.horizon) ? input.horizon : 'year'
  const status = typeof input.status === 'string' && STATUSES.has(input.status) ? input.status : 'planned'
  const priority = typeof input.priority === 'number' && Number.isFinite(input.priority)
    ? Math.max(1, Math.min(5, Math.round(input.priority)))
    : 3

  return {
    value: {
      parentId: typeof input.parentId === 'string' && input.parentId ? input.parentId : null,
      title,
      description: typeof input.description === 'string' ? input.description.trim() : '',
      horizon,
      status,
      priority,
      startDate: typeof input.startDate === 'string' && input.startDate ? input.startDate : null,
      dueDate: typeof input.dueDate === 'string' && input.dueDate ? input.dueDate : null,
      sortOrder: typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : 0,
    },
  }
}

async function readJson(request: Request) {
  try {
    return { body: await request.json() }
  } catch {
    return { error: 'Invalid JSON body' }
  }
}

async function seedStarterGoals(env: Env) {
  const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM life_goals').first<{ count: number }>()

  if ((count?.count ?? 0) > 0) {
    return
  }

  await env.DB.batch(
    STARTER_GOALS.map((goal) => (
      env.DB
        .prepare(`
          INSERT OR IGNORE INTO life_goals (
            id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, datetime('now'), datetime('now'))
        `)
        .bind(
          goal.id,
          goal.parentId,
          goal.title,
          goal.description,
          goal.horizon,
          goal.status,
          goal.priority,
          goal.sortOrder,
        )
    )),
  )
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  await seedStarterGoals(context.env)

  const result = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
      FROM life_goals
      ORDER BY sort_order ASC, created_at ASC
    `)
    .all<GoalRow>()

  return Response.json({ goals: (result.results ?? []).map(toGoal) })
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const parsed = await readJson(context.request)

  if ('error' in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  const normalized = normalizeGoalInput(parsed.body)

  if ('error' in normalized) {
    return Response.json({ error: normalized.error }, { status: 400 })
  }

  const goal = normalized.value
  const id = crypto.randomUUID()

  await context.env.DB
    .prepare(`
      INSERT INTO life_goals (
        id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    .bind(
      id,
      goal.parentId,
      goal.title,
      goal.description,
      goal.horizon,
      goal.status,
      goal.priority,
      goal.startDate,
      goal.dueDate,
      goal.sortOrder,
    )
    .run()

  const row = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
      FROM life_goals
      WHERE id = ?
    `)
    .bind(id)
    .first<GoalRow>()

  return Response.json({ goal: row ? toGoal(row) : null }, { status: 201 })
}

export const onRequestPatch: PagesFunction<Env> = async (context) => {
  const parsed = await readJson(context.request)

  if ('error' in parsed) {
    return Response.json({ error: parsed.error }, { status: 400 })
  }

  if (typeof parsed.body !== 'object' || parsed.body === null) {
    return Response.json({ error: 'JSON body must be an object' }, { status: 400 })
  }

  const input = parsed.body as Record<string, unknown>
  const id = typeof input.id === 'string' ? input.id : ''

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }

  const current = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
      FROM life_goals
      WHERE id = ?
    `)
    .bind(id)
    .first<GoalRow>()

  if (!current) {
    return Response.json({ error: 'Goal not found' }, { status: 404 })
  }

  const next = {
    parentId: typeof input.parentId === 'string' ? input.parentId : current.parent_id,
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : current.title,
    description: typeof input.description === 'string' ? input.description.trim() : current.description,
    horizon: typeof input.horizon === 'string' && HORIZONS.has(input.horizon) ? input.horizon : current.horizon,
    status: typeof input.status === 'string' && STATUSES.has(input.status) ? input.status : current.status,
    priority: typeof input.priority === 'number' && Number.isFinite(input.priority)
      ? Math.max(1, Math.min(5, Math.round(input.priority)))
      : current.priority,
    startDate: typeof input.startDate === 'string' ? input.startDate || null : current.start_date,
    dueDate: typeof input.dueDate === 'string' ? input.dueDate || null : current.due_date,
    sortOrder: typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : current.sort_order,
  }

  await context.env.DB
    .prepare(`
      UPDATE life_goals
      SET parent_id = ?, title = ?, description = ?, horizon = ?, status = ?, priority = ?, start_date = ?, due_date = ?,
          sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(
      next.parentId,
      next.title,
      next.description,
      next.horizon,
      next.status,
      next.priority,
      next.startDate,
      next.dueDate,
      next.sortOrder,
      id,
    )
    .run()

  const row = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, status, priority, start_date, due_date, sort_order, created_at, updated_at
      FROM life_goals
      WHERE id = ?
    `)
    .bind(id)
    .first<GoalRow>()

  return Response.json({ goal: row ? toGoal(row) : null })
}

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url)
  const id = url.searchParams.get('id')

  if (!id) {
    return Response.json({ error: 'id is required' }, { status: 400 })
  }

  await context.env.DB.prepare('DELETE FROM life_goals WHERE id = ?').bind(id).run()

  return Response.json({ ok: true })
}
