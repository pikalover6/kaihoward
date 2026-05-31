#!/usr/bin/env node
/**
 * kai-planner-mcp — a zero-dependency Model Context Protocol (MCP) server that
 * lets Claude (Desktop, Code, or any MCP client) read and edit the personal
 * planner at kaihoward.com/personal.
 *
 * It speaks MCP over stdio (newline-delimited JSON-RPC 2.0) and translates tool
 * calls into HTTPS requests against the Cloudflare Pages API at
 * https://kaihoward.com/personal/api.
 *
 * No npm install required — only Node 18+ (for global fetch). Copy this single
 * file anywhere and point an MCP client at `node kai-planner-mcp.mjs`.
 *
 * Configuration (environment variables):
 *   KAI_API_KEY              (required) the planner API key
 *   KAI_BASE_URL             (optional) defaults to https://kaihoward.com/personal/api
 *   CF_ACCESS_CLIENT_ID      (optional) Cloudflare Access service-token client id
 *   CF_ACCESS_CLIENT_SECRET  (optional) Cloudflare Access service-token secret
 *
 * Everything written to stdout is protocol traffic. All diagnostics go to stderr.
 */

const BASE_URL = (process.env.KAI_BASE_URL || 'https://kaihoward.com/personal/api').replace(/\/$/, '')
const API_KEY = process.env.KAI_API_KEY || ''
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID || ''
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET || ''

const SERVER_INFO = { name: 'kai-planner', version: '1.0.0' }
// Protocol versions we can actually speak, newest first. Used to negotiate in initialize.
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']
const LATEST_PROTOCOL = SUPPORTED_PROTOCOLS[0]

function log(...args) {
  // stderr only — never pollute stdout (the JSON-RPC channel).
  process.stderr.write('[kai-planner-mcp] ' + args.join(' ') + '\n')
}

/* ------------------------------------------------------------------ HTTP --- */

async function api(method, path, body) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' }
  if (API_KEY) headers['X-API-Key'] = API_KEY
  if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
    headers['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID
    headers['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET
  }

  let res
  try {
    res = await fetch(BASE_URL + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual', // a 3xx here means Cloudflare Access bounced us, not a real redirect
    })
  } catch (err) {
    throw new Error(`Network error calling ${method} ${path}: ${err.message}`)
  }

  if (res.status >= 300 && res.status < 400) {
    throw new Error(
      `Request to ${path} was redirected (HTTP ${res.status}) - this almost always means ` +
        `Cloudflare Access blocked it. Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET to a ` +
        `valid Access service token that is allowed on /personal/api.`,
    )
  }

  const text = await res.text()
  let data = null
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!res.ok) {
    const detail = typeof data === 'string' ? data : JSON.stringify(data)
    if (res.status === 401) {
      throw new Error(`Unauthorized (401) on ${path}. Check that KAI_API_KEY is correct. Server said: ${detail}`)
    }
    throw new Error(`API ${method} ${path} failed: HTTP ${res.status} ${res.statusText}. ${String(detail).slice(0, 600)}`)
  }

  return data
}

const fetchGoals = async () => (await api('GET', '/goals')).goals || []

/* --------------------------------------------------------------- helpers --- */

function todayLocal() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Normalize any date-ish string ("2026-5-3", "2026-05-30T14:30") to zero-padded
// YYYY-MM-DD, else null. Guards string date comparisons against non-padded input.
function normDay(value) {
  if (typeof value !== 'string') return null
  const m = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null
}

function buildTree(goals) {
  const byId = new Map(goals.map((g) => [g.id, { ...g, children: [] }]))
  const roots = []
  for (const node of byId.values()) {
    const parent = node.parentId ? byId.get(node.parentId) : null
    if (parent) parent.children.push(node)
    else {
      if (node.parentId) log(`warning: goal ${node.id} references missing parent ${node.parentId}; showing as root`)
      roots.push(node)
    }
  }
  const sortRec = (nodes) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || String(a.title).localeCompare(String(b.title)))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

function descendantIds(goals, id) {
  const out = []
  const seen = new Set() // guard against cyclic data so we never infinite-loop
  const stack = [id]
  while (stack.length) {
    const cur = stack.pop()
    for (const g of goals) {
      if (g.parentId === cur && !seen.has(g.id)) {
        seen.add(g.id)
        out.push(g.id)
        stack.push(g.id)
      }
    }
  }
  return out
}

function statusCounts(goals) {
  const counts = { planned: 0, active: 0, blocked: 0, done: 0 }
  for (const g of goals) counts[g.status] = (counts[g.status] || 0) + 1
  return counts
}

// Build the request body for create/update from a flat set of allowed fields.
function pickGoalFields(args, { includeId } = {}) {
  const body = {}
  if (includeId) body.id = args.id
  const passthrough = [
    'parentId', 'title', 'description', 'durationLabel', 'status', 'priority',
    'startDate', 'dueDate', 'startAt', 'endAt', 'sortOrder', 'x', 'y', 'collapsed',
  ]
  for (const key of passthrough) {
    if (args[key] !== undefined) body[key] = args[key]
  }
  return body
}

/* ----------------------------------------------------------------- tools --- */

const STATUS_ENUM = ['planned', 'active', 'blocked', 'done']

const TOOLS = [
  {
    name: 'get_overview',
    description:
      "Catch-up snapshot of the whole planner: counts by status, today's scheduled items and due items, and the scratch note. Use this first when the user asks an open-ended question like \"what's on my plate\" or \"what's my day look like\".",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => {
      const [goals, note] = await Promise.all([fetchGoals(), api('GET', '/note')])
      const today = todayLocal()
      const todays = goals
        .filter((g) => normDay(g.startAt) === today || normDay(g.dueDate) === today)
        .sort((a, b) => String(a.startAt ?? '99').localeCompare(String(b.startAt ?? '99')))
      return {
        date: today,
        totals: { goals: goals.length, ...statusCounts(goals) },
        today: todays.map(summarize),
        note: note?.content ?? '',
      }
    },
  },
  {
    name: 'list_goals',
    description:
      'List planner goals/tasks. Returns a nested tree by default (each node has a `children` array). Optionally filter by status or restrict to the direct children of a parent. This is the source of truth for what exists and the IDs you need for edits.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: STATUS_ENUM, description: 'Only include goals with this status.' },
        parentId: { type: 'string', description: 'Only include the direct children of this goal id.' },
        view: { type: 'string', enum: ['tree', 'flat'], description: 'tree (default) or flat list.' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      let goals = await fetchGoals()
      if (args.parentId) goals = goals.filter((g) => g.parentId === args.parentId)
      if (args.status) goals = goals.filter((g) => g.status === args.status)
      if (args.view === 'flat') return { count: goals.length, goals }
      return { count: goals.length, tree: buildTree(goals) }
    },
  },
  {
    name: 'get_schedule',
    description:
      'The schedule for a date range: every goal whose scheduled time (startAt) or due date falls within [from, to], sorted by time. Defaults to today. Dates are YYYY-MM-DD. Use this for "what\'s my schedule today / this week".',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date YYYY-MM-DD (default: today).' },
        to: { type: 'string', description: 'End date YYYY-MM-DD inclusive (default: same as from).' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const from = normDay(args.from) || todayLocal()
      const to = normDay(args.to) || from
      const goals = await fetchGoals()
      const inRange = (d) => d && d >= from && d <= to
      const items = goals
        .filter((g) => inRange(normDay(g.startAt)) || inRange(normDay(g.dueDate)))
        .sort((a, b) => String(a.startAt ?? a.dueDate ?? '99').localeCompare(String(b.startAt ?? b.dueDate ?? '99')))
      return { from, to, count: items.length, items: items.map(summarize) }
    },
  },
  {
    name: 'search_goals',
    description: 'Find goals whose title or description contains the query text (case-insensitive). Use to locate an item by name before editing it.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Text to search for.' } },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const q = String(args.query || '').toLowerCase()
      const goals = await fetchGoals()
      const matches = goals.filter(
        (g) => String(g.title).toLowerCase().includes(q) || String(g.description).toLowerCase().includes(q),
      )
      return { query: args.query, count: matches.length, matches: matches.map(summarize) }
    },
  },
  {
    name: 'create_goal',
    description:
      'Create a new goal/task/event. Only `title` is required. Nest it under another item with `parentId`. Give it a calendar slot with `startAt`/`endAt` (ISO local datetime "YYYY-MM-DDTHH:MM") and/or a deadline with `dueDate` ("YYYY-MM-DD"). `durationLabel` is free text like "45 min" or "1 week".',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Goal title (required).' },
        description: { type: 'string' },
        parentId: { type: 'string', description: 'Parent goal id to nest under (omit for a top-level goal).' },
        durationLabel: { type: 'string', description: 'Free-text duration, e.g. "45 min", "3 weeks", "Spring 2027".' },
        status: { type: 'string', enum: STATUS_ENUM },
        priority: { type: 'integer', minimum: 1, maximum: 5, description: '1 (low) to 5 (high).' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD deadline.' },
        startAt: { type: 'string', description: 'Scheduled start, ISO local datetime "YYYY-MM-DDTHH:MM".' },
        endAt: { type: 'string', description: 'Scheduled end, ISO local datetime "YYYY-MM-DDTHH:MM".' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const res = await api('POST', '/goals', pickGoalFields(args))
      return { created: res.goal }
    },
  },
  {
    name: 'update_goal',
    description:
      'Edit an existing goal by id. Pass only the fields you want to change. Use this to rename, reschedule (startAt/endAt/dueDate), reprioritize, change status, edit the description, or set durationLabel. To clear a date/time field, pass an empty string "".',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Goal id (required).' },
        title: { type: 'string' },
        description: { type: 'string' },
        parentId: { type: 'string', description: 'New parent id; "" to move to top level. Prefer move_goal for re-nesting.' },
        durationLabel: { type: 'string' },
        status: { type: 'string', enum: STATUS_ENUM },
        priority: { type: 'integer', minimum: 1, maximum: 5 },
        startDate: { type: 'string', description: 'YYYY-MM-DD, or "" to clear.' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD, or "" to clear.' },
        startAt: { type: 'string', description: 'ISO local datetime, or "" to clear.' },
        endAt: { type: 'string', description: 'ISO local datetime, or "" to clear.' },
        sortOrder: { type: 'integer' },
        collapsed: { type: 'boolean' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const res = await api('PATCH', '/goals', pickGoalFields(args, { includeId: true }))
      return { updated: res.goal }
    },
  },
  {
    name: 'complete_goal',
    description: 'Mark a goal done (or reopen it). Convenience wrapper around status. Set done=false to reopen as active.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        done: { type: 'boolean', description: 'true = mark done (default), false = reopen as active.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const status = args.done === false ? 'active' : 'done'
      const res = await api('PATCH', '/goals', { id: args.id, status })
      return { updated: res.goal }
    },
  },
  {
    name: 'move_goal',
    description:
      'Re-nest a goal under a different parent (rearrange the hierarchy). Set newParentId to null/"" to move it to the top level. Optionally set sortOrder to position it among its new siblings. Guards against cycles.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        newParentId: { type: ['string', 'null'], description: 'Target parent id, or null/"" for top level.' },
        sortOrder: { type: 'integer', description: 'Optional ordering among siblings (lower = earlier).' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const goals = await fetchGoals()
      if (!goals.find((g) => g.id === args.id)) throw new Error(`Goal not found: ${args.id}`)
      const target = args.newParentId === null || args.newParentId === undefined ? '' : String(args.newParentId)
      if (target) {
        if (target === args.id) throw new Error('A goal cannot be its own parent.')
        if (!goals.find((g) => g.id === target)) throw new Error(`Target parent not found: ${target}`)
        if (descendantIds(goals, args.id).includes(target)) {
          throw new Error('Cannot move a goal under one of its own descendants (would create a cycle).')
        }
      }
      const body = { id: args.id, parentId: target }
      if (typeof args.sortOrder === 'number') body.sortOrder = args.sortOrder
      const res = await api('PATCH', '/goals', body)
      return { moved: res.goal }
    },
  },
  {
    name: 'reorder_goals',
    description:
      'Set the explicit order of a group of sibling goals. Pass orderedIds in the desired order; each is assigned an increasing sortOrder. Useful for "rearrange these into this order".',
    inputSchema: {
      type: 'object',
      properties: {
        orderedIds: { type: 'array', items: { type: 'string' }, description: 'Goal ids in the desired order.' },
      },
      required: ['orderedIds'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const ids = Array.isArray(args.orderedIds) ? args.orderedIds : []
      const results = []
      for (let i = 0; i < ids.length; i++) {
        const res = await api('PATCH', '/goals', { id: ids[i], sortOrder: i * 10 })
        results.push(res.goal && { id: res.goal.id, title: res.goal.title, sortOrder: res.goal.sortOrder })
      }
      return { reordered: results }
    },
  },
  {
    name: 'delete_goal',
    description: 'Delete a goal and ALL of its descendants (the whole branch). This cannot be undone — confirm with the user first for anything non-trivial.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
    handler: async (args) => {
      const goals = await fetchGoals()
      const removed = [args.id, ...descendantIds(goals, args.id)]
      await api('DELETE', `/goals?id=${encodeURIComponent(args.id)}`)
      return { ok: true, deletedIds: removed, deletedCount: removed.length }
    },
  },
  {
    name: 'get_note',
    description: 'Read the planner scratch note (a single freeform markdown text area).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: async () => ({ content: (await api('GET', '/note')).content ?? '' }),
  },
  {
    name: 'update_note',
    description: 'Replace the entire planner scratch note with new content. This overwrites the existing note — read it first with get_note if you need to append.',
    inputSchema: {
      type: 'object',
      properties: { content: { type: 'string' } },
      required: ['content'],
      additionalProperties: false,
    },
    handler: async (args) => {
      await api('PUT', '/note', { content: String(args.content ?? '') })
      return { ok: true }
    },
  },
]

// Compact view of a goal for schedule/overview listings.
function summarize(g) {
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
  }
}

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))
// Public tool list excludes the internal handler function.
const TOOL_DEFS = TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))

/* ------------------------------------------------------------- JSON-RPC --- */

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result })
}

function sendError(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function handleRequest(msg) {
  const { id, method, params } = msg

  switch (method) {
    case 'initialize': {
      // Per MCP spec: echo the client's version if we support it, otherwise offer our latest.
      const requested = typeof params?.protocolVersion === 'string' ? params.protocolVersion : ''
      return sendResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : LATEST_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
      })
    }

    case 'ping':
      return sendResult(id, {})

    case 'tools/list':
      return sendResult(id, { tools: TOOL_DEFS })

    case 'tools/call': {
      const tool = TOOLS_BY_NAME.get(params?.name)
      if (!tool) return sendError(id, -32602, `Unknown tool: ${params?.name}`)
      try {
        const result = await tool.handler(params.arguments || {})
        const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
        return sendResult(id, { content: [{ type: 'text', text }] })
      } catch (err) {
        log(`tool ${params?.name} error:`, err.message)
        // Per MCP, tool failures are returned as a result with isError so the model can react.
        return sendResult(id, { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true })
      }
    }

    // Methods we don't implement but might be probed for — answer politely.
    case 'resources/list':
      return sendResult(id, { resources: [] })
    case 'prompts/list':
      return sendResult(id, { prompts: [] })

    default:
      return sendError(id, -32601, `Method not found: ${method}`)
  }
}

function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return
  // Notification (no id) — handle the ones we care about, ignore the rest.
  if (msg.id === undefined || msg.id === null) {
    if (msg.method === 'notifications/initialized') log('client initialized')
    return
  }
  handleRequest(msg).catch((err) => {
    log('handler crash:', err.message)
    sendError(msg.id, -32603, `Internal error: ${err.message}`)
  })
}

/* ----------------------------------------------------------------- main --- */

let buffer = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let nl
  while ((nl = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, nl).trim()
    buffer = buffer.slice(nl + 1)
    if (!line) continue
    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      sendError(null, -32700, 'Parse error')
      continue
    }
    if (Array.isArray(parsed)) parsed.forEach(handleMessage)
    else handleMessage(parsed)
  }
})
process.stdin.on('end', () => process.exit(0))

if (!API_KEY) log('WARNING: KAI_API_KEY is not set — API calls will be unauthorized.')
log(`ready - base ${BASE_URL}${CF_ACCESS_CLIENT_ID ? ' (with CF Access service token)' : ''}`)
