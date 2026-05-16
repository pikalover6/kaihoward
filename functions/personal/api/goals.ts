export interface Env {
  DB: D1Database
}

type GoalRow = {
  id: string
  parent_id: string | null
  title: string
  description: string
  horizon: string
  duration_label: string | null
  status: string
  priority: number
  start_date: string | null
  due_date: string | null
  sort_order: number
  x: number | null
  y: number | null
  collapsed: number
  created_at: string
  updated_at: string
}

const HORIZONS = new Set(['life', 'five-year', 'year', 'semester', 'month', 'week', 'day', 'minute', 'custom'])
const STATUSES = new Set(['planned', 'active', 'blocked', 'done'])

function toGoal(row: GoalRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    horizon: row.horizon,
    durationLabel: row.duration_label,
    status: row.status,
    priority: row.priority,
    startDate: row.start_date,
    dueDate: row.due_date,
    sortOrder: row.sort_order,
    x: row.x,
    y: row.y,
    collapsed: row.collapsed === 1,
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
      durationLabel: typeof input.durationLabel === 'string' ? input.durationLabel.trim() : '',
      status,
      priority,
      startDate: typeof input.startDate === 'string' && input.startDate ? input.startDate : null,
      dueDate: typeof input.dueDate === 'string' && input.dueDate ? input.dueDate : null,
      sortOrder: typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : 0,
      x: typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : null,
      y: typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : null,
      collapsed: typeof input.collapsed === 'boolean' && input.collapsed,
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

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const result = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at
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
        id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `)
    .bind(
      id,
      goal.parentId,
      goal.title,
      goal.description,
      goal.horizon,
      goal.durationLabel,
      goal.status,
      goal.priority,
      goal.startDate,
      goal.dueDate,
      goal.sortOrder,
      goal.x,
      goal.y,
      goal.collapsed ? 1 : 0,
    )
    .run()

  const row = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at
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
      SELECT id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at
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
    durationLabel: typeof input.durationLabel === 'string' ? input.durationLabel.trim() : current.duration_label,
    status: typeof input.status === 'string' && STATUSES.has(input.status) ? input.status : current.status,
    priority: typeof input.priority === 'number' && Number.isFinite(input.priority)
      ? Math.max(1, Math.min(5, Math.round(input.priority)))
      : current.priority,
    startDate: typeof input.startDate === 'string' ? input.startDate || null : current.start_date,
    dueDate: typeof input.dueDate === 'string' ? input.dueDate || null : current.due_date,
    sortOrder: typeof input.sortOrder === 'number' && Number.isFinite(input.sortOrder) ? Math.round(input.sortOrder) : current.sort_order,
    x: typeof input.x === 'number' && Number.isFinite(input.x) ? input.x : current.x,
    y: typeof input.y === 'number' && Number.isFinite(input.y) ? input.y : current.y,
    collapsed: typeof input.collapsed === 'boolean' ? input.collapsed : current.collapsed === 1,
  }

  await context.env.DB
    .prepare(`
      UPDATE life_goals
      SET parent_id = ?, title = ?, description = ?, horizon = ?, duration_label = ?, status = ?, priority = ?, start_date = ?, due_date = ?,
          sort_order = ?, x = ?, y = ?, collapsed = ?, updated_at = datetime('now')
      WHERE id = ?
    `)
    .bind(
      next.parentId,
      next.title,
      next.description,
      next.horizon,
      next.durationLabel,
      next.status,
      next.priority,
      next.startDate,
      next.dueDate,
      next.sortOrder,
      next.x,
      next.y,
      next.collapsed ? 1 : 0,
      id,
    )
    .run()

  const row = await context.env.DB
    .prepare(`
      SELECT id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at
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
