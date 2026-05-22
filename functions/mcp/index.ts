export interface Env {
  DB: D1Database
  API_KEY: string
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, Authorization, MCP-Protocol-Version, Mcp-Session-Id',
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
    collapsed: row.collapsed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function extractApiKey(request: Request): string | null {
  const xApiKey = request.headers.get('X-API-Key')
  if (xApiKey) return xApiKey
  const auth = request.headers.get('Authorization')
  if (auth?.startsWith('Bearer ')) return auth.slice(7)
  return new URL(request.url).searchParams.get('api_key')
}

function rpcError(id: unknown, code: number, message: string) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message } }, { headers: CORS_HEADERS })
}

function rpcResult(id: unknown, result: unknown) {
  return Response.json({ jsonrpc: '2.0', id, result }, { headers: CORS_HEADERS })
}

function toolText(text: string, isError = false) {
  return { content: [{ type: 'text', text }], isError }
}

const HORIZONS = new Set(['life', 'five-year', 'year', 'semester', 'month', 'week', 'day', 'minute', 'custom'])
const STATUSES = new Set(['planned', 'active', 'blocked', 'done'])

const GOAL_SELECT = `SELECT id, parent_id, title, description, horizon, duration_label, status, priority,
  start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at FROM life_goals`

const TOOLS = [
  {
    name: 'list_goals',
    description: 'List all goals from the personal planning app, ordered by sort_order',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'create_goal',
    description: 'Create a new goal',
    inputSchema: {
      type: 'object',
      required: ['title'],
      properties: {
        title: { type: 'string', description: 'Goal title' },
        horizon: { type: 'string', enum: [...HORIZONS], description: 'Time horizon (default: year)' },
        status: { type: 'string', enum: [...STATUSES], description: 'Status (default: planned)' },
        priority: { type: 'number', description: 'Priority 1–5 (default: 3)' },
        description: { type: 'string' },
        parentId: { type: 'string', description: 'Parent goal ID for sub-goals' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
      },
    },
  },
  {
    name: 'update_goal',
    description: 'Update an existing goal — only provided fields change',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Goal ID' },
        title: { type: 'string' },
        horizon: { type: 'string', enum: [...HORIZONS] },
        status: { type: 'string', enum: [...STATUSES] },
        priority: { type: 'number', description: 'Priority 1–5' },
        description: { type: 'string' },
        parentId: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, or empty string to clear' },
      },
    },
  },
  {
    name: 'delete_goal',
    description: 'Delete a goal by ID',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: {
        id: { type: 'string', description: 'Goal ID to delete' },
      },
    },
  },
  {
    name: 'get_note',
    description: 'Get the main scratchpad note content',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'update_note',
    description: 'Replace the main scratchpad note content entirely',
    inputSchema: {
      type: 'object',
      required: ['content'],
      properties: {
        content: { type: 'string', description: 'New note content (replaces existing)' },
      },
    },
  },
]

async function callTool(name: string, args: Record<string, unknown>, env: Env) {
  if (name === 'list_goals') {
    const { results = [] } = await env.DB
      .prepare(`${GOAL_SELECT} ORDER BY sort_order ASC, created_at ASC`)
      .all<GoalRow>()
    return toolText(JSON.stringify({ goals: results.map(toGoal) }, null, 2))
  }

  if (name === 'create_goal') {
    const title = typeof args.title === 'string' ? args.title.trim() : ''
    if (!title) return toolText('title is required', true)

    const id = crypto.randomUUID()
    const horizon = typeof args.horizon === 'string' && HORIZONS.has(args.horizon) ? args.horizon : 'year'
    const status = typeof args.status === 'string' && STATUSES.has(args.status) ? args.status : 'planned'
    const priority = typeof args.priority === 'number' ? Math.max(1, Math.min(5, Math.round(args.priority))) : 3

    await env.DB
      .prepare(`INSERT INTO life_goals
        (id, parent_id, title, description, horizon, duration_label, status, priority, start_date, due_date, sort_order, x, y, collapsed, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, 0, null, null, 0, datetime('now'), datetime('now'))`)
      .bind(
        id,
        typeof args.parentId === 'string' && args.parentId ? args.parentId : null,
        title,
        typeof args.description === 'string' ? args.description.trim() : '',
        horizon,
        status,
        priority,
        typeof args.startDate === 'string' && args.startDate ? args.startDate : null,
        typeof args.dueDate === 'string' && args.dueDate ? args.dueDate : null,
      )
      .run()

    const row = await env.DB
      .prepare(`${GOAL_SELECT} WHERE id = ?`)
      .bind(id)
      .first<GoalRow>()

    return toolText(JSON.stringify({ goal: row ? toGoal(row) : null }, null, 2))
  }

  if (name === 'update_goal') {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    if (!id) return toolText('id is required', true)

    const current = await env.DB
      .prepare(`${GOAL_SELECT} WHERE id = ?`)
      .bind(id)
      .first<GoalRow>()

    if (!current) return toolText(`Goal not found: ${id}`, true)

    await env.DB
      .prepare(`UPDATE life_goals SET
        parent_id = ?, title = ?, description = ?, horizon = ?, status = ?, priority = ?,
        start_date = ?, due_date = ?, updated_at = datetime('now')
        WHERE id = ?`)
      .bind(
        typeof args.parentId === 'string' ? (args.parentId || null) : current.parent_id,
        typeof args.title === 'string' && args.title.trim() ? args.title.trim() : current.title,
        typeof args.description === 'string' ? args.description.trim() : current.description,
        typeof args.horizon === 'string' && HORIZONS.has(args.horizon) ? args.horizon : current.horizon,
        typeof args.status === 'string' && STATUSES.has(args.status) ? args.status : current.status,
        typeof args.priority === 'number' ? Math.max(1, Math.min(5, Math.round(args.priority))) : current.priority,
        typeof args.startDate === 'string' ? (args.startDate || null) : current.start_date,
        typeof args.dueDate === 'string' ? (args.dueDate || null) : current.due_date,
        id,
      )
      .run()

    const row = await env.DB
      .prepare(`${GOAL_SELECT} WHERE id = ?`)
      .bind(id)
      .first<GoalRow>()

    return toolText(JSON.stringify({ goal: row ? toGoal(row) : null }, null, 2))
  }

  if (name === 'delete_goal') {
    const id = typeof args.id === 'string' ? args.id.trim() : ''
    if (!id) return toolText('id is required', true)
    await env.DB.prepare('DELETE FROM life_goals WHERE id = ?').bind(id).run()
    return toolText(JSON.stringify({ ok: true, deletedId: id }))
  }

  if (name === 'get_note') {
    await env.DB
      .prepare("INSERT OR IGNORE INTO personal_notes (id, content, updated_at) VALUES ('main', '', datetime('now'))")
      .run()
    const row = await env.DB
      .prepare("SELECT content FROM personal_notes WHERE id = 'main'")
      .first<{ content: string }>()
    return toolText(JSON.stringify({ content: row?.content ?? '' }, null, 2))
  }

  if (name === 'update_note') {
    if (typeof args.content !== 'string') return toolText('content must be a string', true)
    await env.DB
      .prepare(`INSERT INTO personal_notes (id, content, updated_at) VALUES ('main', ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
      .bind(args.content)
      .run()
    return toolText(JSON.stringify({ ok: true }))
  }

  return toolText(`Unknown tool: ${name}`, true)
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  const provided = extractApiKey(request)
  if (!provided || provided !== env.API_KEY) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: CORS_HEADERS })
  }

  // GET: we don't push server-initiated messages
  if (request.method === 'GET') {
    return new Response(null, { status: 405, headers: CORS_HEADERS })
  }

  // DELETE: session termination — accept and ignore
  if (request.method === 'DELETE') {
    return new Response(null, { status: 200, headers: CORS_HEADERS })
  }

  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: CORS_HEADERS })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return rpcError(null, -32700, 'Parse error')
  }

  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return rpcError(null, -32600, 'Invalid Request')
  }

  const msg = body as Record<string, unknown>
  const id = 'id' in msg ? msg.id : null
  const method = msg.method

  if (msg.jsonrpc !== '2.0' || typeof method !== 'string') {
    return rpcError(id, -32600, 'Invalid Request')
  }

  // Notifications have no id and need no response
  if (!('id' in msg)) {
    return new Response(null, { status: 202, headers: CORS_HEADERS })
  }

  if (method === 'initialize') {
    return rpcResult(id, {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'kaihoward-mcp', version: '1.0.0' },
    })
  }

  if (method === 'tools/list') {
    return rpcResult(id, { tools: TOOLS })
  }

  if (method === 'tools/call') {
    const params = msg.params as { name?: unknown; arguments?: unknown } | undefined
    const toolName = params?.name
    const toolArgs = (typeof params?.arguments === 'object' && params.arguments !== null)
      ? params.arguments as Record<string, unknown>
      : {}

    if (typeof toolName !== 'string') {
      return rpcError(id, -32602, 'Invalid params: name is required')
    }

    if (!TOOLS.find(t => t.name === toolName)) {
      return rpcError(id, -32602, `Unknown tool: ${toolName}`)
    }

    try {
      const result = await callTool(toolName, toolArgs, env)
      return rpcResult(id, result)
    } catch (err) {
      return rpcResult(id, toolText(String(err), true))
    }
  }

  return rpcError(id, -32601, `Method not found: ${method}`)
}
