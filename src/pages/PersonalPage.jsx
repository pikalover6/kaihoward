import { useEffect, useMemo, useRef, useState } from 'react'
import PushControls from '../PushControls.jsx'

const DURATION_FALLBACKS = {
  life: 'Lifetime',
  'five-year': '5 years',
  year: '1 year',
  semester: 'Semester',
  month: '1 month',
  week: '1 week',
  day: '1 day',
  minute: 'Immediate',
}

const STATUS_LABELS = {
  planned: 'Planned',
  active: 'Active',
  blocked: 'Blocked',
  done: 'Done',
}

const VIEWPORT_CENTER = { x: 540, y: 320 }
const NODE_WIDTH = 220
const NODE_HEIGHT = 108

const TREE_X_GAP = 320
const TREE_Y_GAP = 168

const LAYOUT_X_GAP = 340
const LAYOUT_Y_GAP = 30
const LAYOUT_ROOT_PAD = 80
const LAYOUT_ORIGIN_X = 120
const LAYOUT_ORIGIN_Y = 80

const BEZIER_STRENGTH = 0.45
const LAYOUT_ANIM_DURATION = 420
const LAYOUT_RELAX_ITERATIONS = 8
const LAYOUT_OVERLAP_PAD = 12

// Week calendar
const WEEK_HOUR_START = 6
const WEEK_HOUR_END = 23
const WEEK_HOUR_PX = 64

const MICRO_HORIZONS = new Set(['day', 'minute'])

function getChildren(goals, parentId) {
  return goals
    .filter((goal) => goal.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
}

function flattenGoals(goals, parentId = null, depth = 0) {
  return getChildren(goals, parentId).flatMap((goal) => [
    { ...goal, depth },
    ...flattenGoals(goals, goal.id, depth + 1),
  ])
}

function getDescendantIds(goals, id) {
  return getChildren(goals, id).flatMap((goal) => [goal.id, ...getDescendantIds(goals, goal.id)])
}

function getLineage(goals, goal) {
  const path = []
  let cursor = goal
  while (cursor) {
    path.unshift(cursor)
    cursor = goals.find((item) => item.id === cursor.parentId)
  }
  return path
}

function getInitialPosition(goals, parentId) {
  if (parentId) {
    const parent = goals.find((goal) => goal.id === parentId)
    const siblingCount = getChildren(goals, parentId).length
    return {
      x: (parent?.x ?? VIEWPORT_CENTER.x) + TREE_X_GAP,
      y: (parent?.y ?? VIEWPORT_CENTER.y) + (siblingCount - 0.5) * TREE_Y_GAP,
    }
  }
  const rootCount = getChildren(goals, null).length
  return {
    x: VIEWPORT_CENTER.x,
    y: VIEWPORT_CENTER.y + rootCount * TREE_Y_GAP,
  }
}

function getVisibleCanvasGoals(goals) {
  const hidden = new Set()
  goals.forEach((goal) => {
    if (goal.collapsed) {
      getDescendantIds(goals, goal.id).forEach((id) => hidden.add(id))
    }
  })
  return goals.filter((goal) => !hidden.has(goal.id))
}

function monthMatrix(date) {
  const year = date.getFullYear()
  const month = date.getMonth()
  const first = new Date(year, month, 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

function dateKey(date) {
  return date.toISOString().slice(0, 10)
}

function getWeekStart(date) {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() - day + (day === 0 ? -6 : 1))
  d.setHours(0, 0, 0, 0)
  return d
}

function stepWeek(start, delta) {
  const d = new Date(start)
  d.setDate(d.getDate() + delta * 7)
  return d
}

function weekDays(monday) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function goalBlockTop(startAt) {
  const h = parseInt(startAt.slice(11, 13), 10)
  const m = parseInt(startAt.slice(14, 16), 10)
  return (h - WEEK_HOUR_START + m / 60) * WEEK_HOUR_PX
}

function goalBlockHeight(startAt, endAt) {
  if (!endAt) return WEEK_HOUR_PX
  const sh = parseInt(startAt.slice(11, 13), 10) * 60 + parseInt(startAt.slice(14, 16), 10)
  const eh = parseInt(endAt.slice(11, 13), 10) * 60 + parseInt(endAt.slice(14, 16), 10)
  return Math.max(28, ((Math.max(30, eh - sh)) / 60) * WEEK_HOUR_PX)
}

function statusCopy(status) {
  return STATUS_LABELS[status] ?? 'Planned'
}

function durationCopy(goal) {
  return goal.durationLabel || DURATION_FALLBACKS[goal.horizon] || goal.horizon || 'Custom'
}

const DAY_NAMES_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dayOfWeekIndex(date) {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

function PersonalPage() {
  const [goals, setGoals] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState('canvas')
  const [calendarSubMode, setCalendarSubMode] = useState('week')
  const [status, setStatus] = useState('loading')
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 0.9 })
  const [dragging, setDragging] = useState(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [showMicro, setShowMicro] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()))
  const [expandedDay, setExpandedDay] = useState(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    parentId: '',
    durationLabel: '',
    status: 'planned',
    priority: 3,
    dueDate: '',
    startAt: '',
    endAt: '',
  })
  const [inspectorDraft, setInspectorDraft] = useState({
    title: '',
    description: '',
    durationLabel: '',
  })
  const canvasRef = useRef(null)
  const weekScrollRef = useRef(null)

  const selectedGoal = goals.find((goal) => goal.id === selectedId) ?? null
  const visibleGoals = useMemo(() => {
    let nodes = getVisibleCanvasGoals(goals)
    if (!showMicro) nodes = nodes.filter((g) => !MICRO_HORIZONS.has(g.horizon))
    return nodes
  }, [goals, showMicro])
  const visibleIds = useMemo(() => new Set(visibleGoals.map((goal) => goal.id)), [visibleGoals])
  const flatGoals = useMemo(() => flattenGoals(goals), [goals])
  const activeGoals = goals.filter((goal) => goal.status !== 'done')
  const monthDays = useMemo(() => monthMatrix(calendarDate), [calendarDate])
  const currentWeekDays = useMemo(() => weekDays(weekStart), [weekStart])
  const todayKey = dateKey(new Date())

  useEffect(() => {
    async function loadGoals() {
      setStatus('loading')
      try {
        const response = await fetch('/personal/api/goals')
        if (!response.ok) throw new Error('Could not load goals')
        const data = await response.json()
        setGoals(data.goals ?? [])
        setSelectedId(data.goals?.[0]?.id ?? '')
        setStatus('synced')
      } catch {
        setStatus('offline')
      }
    }
    loadGoals()
  }, [])

  // Scroll week grid to 8am when entering week view
  useEffect(() => {
    if (mode === 'calendar' && calendarSubMode === 'week' && weekScrollRef.current) {
      weekScrollRef.current.scrollTop = (8 - WEEK_HOUR_START) * WEEK_HOUR_PX
    }
  }, [mode, calendarSubMode])

  useEffect(() => {
    if (!selectedGoal) {
      setInspectorDraft({ title: '', description: '', durationLabel: '' })
      return
    }
    setInspectorDraft({
      title: selectedGoal.title,
      description: selectedGoal.description,
      durationLabel: durationCopy(selectedGoal),
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGoal?.id])

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)')
    setIsMobile(mq.matches)
    const handler = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  function openDraft(parentId = '', overrides = {}) {
    const parent = goals.find((goal) => goal.id === parentId)
    setForm({
      title: '',
      description: '',
      parentId,
      durationLabel: parent ? '' : '1 year',
      status: 'planned',
      priority: parent ? Math.max(1, parent.priority - 1) : 3,
      dueDate: '',
      startAt: '',
      endAt: '',
      ...overrides,
    })
    setDraftOpen(true)
  }

  async function createGoal(event) {
    event.preventDefault()
    const title = form.title.trim()
    if (!title) return

    const position = getInitialPosition(goals, form.parentId || null)
    const optimisticGoal = {
      id: crypto.randomUUID(),
      parentId: form.parentId || null,
      title,
      description: form.description.trim(),
      horizon: 'custom',
      durationLabel: form.durationLabel.trim(),
      status: form.status,
      priority: Number(form.priority),
      dueDate: form.dueDate,
      startAt: form.startAt,
      endAt: form.endAt,
      startDate: '',
      sortOrder: goals.length + 1,
      collapsed: false,
      x: position.x,
      y: position.y,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setGoals((currentGoals) => [...currentGoals, optimisticGoal])
    setSelectedId(optimisticGoal.id)
    setDraftOpen(false)
    setStatus('saving')

    try {
      const response = await fetch('/personal/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(optimisticGoal),
      })
      if (!response.ok) throw new Error('Could not save goal')
      const data = await response.json()
      if (data.goal) {
        setGoals((currentGoals) => currentGoals.map((goal) => (goal.id === optimisticGoal.id ? data.goal : goal)))
        setSelectedId(data.goal.id)
      }
      setStatus('synced')
    } catch {
      setStatus('offline')
    }
  }

  async function updateGoal(id, updates) {
    setGoals((currentGoals) => currentGoals.map((goal) => (goal.id === id ? { ...goal, ...updates } : goal)))
    setStatus('saving')
    try {
      const response = await fetch('/personal/api/goals', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...updates }),
      })
      if (!response.ok) throw new Error('Could not update goal')
      const data = await response.json()
      if (data.goal) {
        setGoals((currentGoals) => currentGoals.map((goal) => (goal.id === id ? data.goal : goal)))
      }
      setStatus('synced')
    } catch {
      setStatus('offline')
    }
  }

  function commitInspectorDraft() {
    if (!selectedGoal) return
    const updates = {}
    const title = inspectorDraft.title.trim()
    const description = inspectorDraft.description.trim()
    const durationLabel = inspectorDraft.durationLabel.trim()
    if (title && title !== selectedGoal.title) updates.title = title
    if (description !== selectedGoal.description) updates.description = description
    if (durationLabel !== durationCopy(selectedGoal)) updates.durationLabel = durationLabel
    if (Object.keys(updates).length > 0) updateGoal(selectedGoal.id, updates)
  }

  function toggleDone(goal) {
    updateGoal(goal.id, { status: goal.status === 'done' ? 'active' : 'done' })
  }

  async function deleteGoal(id) {
    const deletedIds = new Set([id, ...getDescendantIds(goals, id)])
    const nextGoals = goals.filter((goal) => !deletedIds.has(goal.id))
    setGoals(nextGoals)
    setSelectedId(nextGoals[0]?.id ?? '')
    setStatus('saving')
    try {
      await fetch(`/personal/api/goals?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setStatus('synced')
    } catch {
      setStatus('offline')
    }
  }

  function beginPan(event) {
    if (event.target.closest('.canvas-node') || event.target.closest('.chrome-control')) return
    setDragging({ type: 'pan', startX: event.clientX, startY: event.clientY, origin: viewport })
  }

  function beginNodeDrag(event, goal) {
    event.stopPropagation()
    setSelectedId(goal.id)
    setDragging({
      type: 'node',
      id: goal.id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: goal.x ?? VIEWPORT_CENTER.x, y: goal.y ?? VIEWPORT_CENTER.y },
    })
  }

  function moveDrag(event) {
    if (!dragging) return
    if (dragging.type === 'pan') {
      setViewport({
        ...dragging.origin,
        x: dragging.origin.x + event.clientX - dragging.startX,
        y: dragging.origin.y + event.clientY - dragging.startY,
      })
      return
    }
    const nextPosition = {
      x: dragging.origin.x + (event.clientX - dragging.startX) / viewport.scale,
      y: dragging.origin.y + (event.clientY - dragging.startY) / viewport.scale,
    }
    setGoals((currentGoals) => currentGoals.map((goal) => (goal.id === dragging.id ? { ...goal, ...nextPosition } : goal)))
  }

  function endDrag() {
    if (dragging?.type === 'node') {
      const goal = goals.find((item) => item.id === dragging.id)
      if (goal) updateGoal(goal.id, { x: goal.x, y: goal.y })
    }
    setDragging(null)
  }

  function zoomToward(clientX, clientY, nextScale) {
    const bounds = canvasRef.current?.getBoundingClientRect()
    if (!bounds) {
      setViewport((current) => ({ ...current, scale: nextScale }))
      return
    }
    setViewport((current) => {
      const worldX = (clientX - bounds.left - current.x) / current.scale
      const worldY = (clientY - bounds.top - current.y) / current.scale
      return {
        x: clientX - bounds.left - worldX * nextScale,
        y: clientY - bounds.top - worldY * nextScale,
        scale: nextScale,
      }
    })
  }

  function handleWheel(event) {
    event.preventDefault()
    if (event.shiftKey) {
      setViewport((current) => ({
        ...current,
        x: current.x - event.deltaY,
        y: current.y - event.deltaX,
      }))
      return
    }
    const direction = event.deltaY > 0 ? -1 : 1
    const nextScale = Math.max(0.35, Math.min(1.8, Number((viewport.scale + direction * 0.08).toFixed(2))))
    zoomToward(event.clientX, event.clientY, nextScale)
  }

  function zoomBy(amount) {
    setViewport((current) => ({
      ...current,
      scale: Math.max(0.35, Math.min(1.8, Number((current.scale + amount).toFixed(2)))),
    }))
  }

  function resetView() {
    setViewport({ x: 0, y: 0, scale: 0.9 })
  }

  function beginTouchPan(event) {
    if (event.touches.length !== 1) return
    if (event.target.closest('.canvas-node') || event.target.closest('.zoom-float') || event.target.closest('.blank-slate')) return
    const touch = event.touches[0]
    setDragging({ type: 'pan', startX: touch.clientX, startY: touch.clientY, origin: viewport })
  }

  function moveTouchPan(event) {
    if (!dragging || dragging.type !== 'pan' || event.touches.length !== 1) return
    const touch = event.touches[0]
    setViewport({
      ...dragging.origin,
      x: dragging.origin.x + touch.clientX - dragging.startX,
      y: dragging.origin.y + touch.clientY - dragging.startY,
    })
  }

  function endTouchPan() {
    setDragging(null)
  }

  function autoLayout() {
    const positions = {}

    function subtreeHeight(goalId) {
      const children = getChildren(goals, goalId)
      if (children.length === 0) return NODE_HEIGHT
      const childrenTotal = children.reduce((sum, child) => sum + subtreeHeight(child.id), 0)
      const gaps = LAYOUT_Y_GAP * (children.length - 1)
      return childrenTotal + gaps
    }

    function placeSubtree(goalId, depth, centreY) {
      positions[goalId] = {
        x: LAYOUT_ORIGIN_X + depth * LAYOUT_X_GAP,
        y: centreY - NODE_HEIGHT / 2,
      }
      const children = getChildren(goals, goalId)
      if (children.length === 0) return
      const totalHeight = children.reduce((sum, child) => sum + subtreeHeight(child.id), 0)
        + LAYOUT_Y_GAP * (children.length - 1)
      let cursor = centreY - totalHeight / 2
      children.forEach((child) => {
        const childHeight = subtreeHeight(child.id)
        const childCentre = cursor + childHeight / 2
        placeSubtree(child.id, depth + 1, childCentre)
        cursor += childHeight + LAYOUT_Y_GAP
      })
    }

    const roots = getChildren(goals, null)
    let topCursor = LAYOUT_ORIGIN_Y
    roots.forEach((root) => {
      const height = subtreeHeight(root.id)
      const centre = topCursor + height / 2
      placeSubtree(root.id, 0, centre)
      topCursor += height + LAYOUT_ROOT_PAD
    })

    const ids = Object.keys(positions)
    for (let iter = 0; iter < LAYOUT_RELAX_ITERATIONS; iter++) {
      let moved = false
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const a = positions[ids[i]]
          const b = positions[ids[j]]
          const pw = NODE_WIDTH + LAYOUT_OVERLAP_PAD
          const ph = NODE_HEIGHT + LAYOUT_OVERLAP_PAD
          const overlapX = Math.abs(a.x - b.x) < pw
          const overlapY = Math.abs(a.y - b.y) < ph
          if (overlapX && overlapY) {
            const pushY = (ph - Math.abs(a.y - b.y)) / 2 + 1
            if (a.y <= b.y) { a.y -= pushY; b.y += pushY }
            else { a.y += pushY; b.y -= pushY }
            moved = true
          }
        }
      }
      if (!moved) break
    }

    const startPositions = {}
    goals.forEach((goal) => {
      startPositions[goal.id] = { x: goal.x ?? VIEWPORT_CENTER.x, y: goal.y ?? VIEWPORT_CENTER.y }
    })
    const startTime = performance.now()

    function easeInOut(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
    }

    function tick() {
      const elapsed = performance.now() - startTime
      const rawT = Math.min(elapsed / LAYOUT_ANIM_DURATION, 1)
      const t = easeInOut(rawT)

      if (rawT < 1) {
        setGoals((currentGoals) =>
          currentGoals.map((goal) => {
            const start = startPositions[goal.id]
            const end = positions[goal.id]
            if (!start || !end) return goal
            return { ...goal, x: start.x + (end.x - start.x) * t, y: start.y + (end.y - start.y) * t }
          })
        )
        requestAnimationFrame(tick)
      } else {
        setGoals((currentGoals) =>
          currentGoals.map((goal) => ({ ...goal, ...(positions[goal.id] ?? {}) }))
        )
        Object.keys(positions).forEach((id) => {
          updateGoal(id, { x: positions[id].x, y: positions[id].y })
        })
      }
    }

    requestAnimationFrame(tick)
  }

  function goalsForDay(day) {
    const key = dateKey(day)
    return goals
      .filter((goal) => goal.dueDate === key || (goal.startAt && goal.startAt.slice(0, 10) === key))
      .sort((a, b) => (a.startAt ?? '99').localeCompare(b.startAt ?? '99'))
  }

  function toggleExpandedDay(day) {
    setExpandedDay((prev) => (prev && dateKey(prev) === dateKey(day) ? null : day))
  }

  function scheduleToday(goalId) {
    const today = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const startAt = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}T09:00`
    updateGoal(goalId, { startAt })
  }

  const syncLabel = status === 'loading' ? 'syncing' : status === 'saving' ? 'saving' : status === 'offline' ? 'local' : 'synced'

  const weekLabel = (() => {
    const fmt = (d) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    return `${fmt(currentWeekDays[0])} – ${fmt(currentWeekDays[6])}`
  })()

  // Shared day-expand panel content (used in both week and month views)
  function DayExpandPanel() {
    if (!expandedDay) return null
    const pad = (n) => String(n).padStart(2, '0')
    const d = expandedDay
    const startAtDefault = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`

    return (
      <div className="week-day-expand chrome-control">
        <div className="week-expand-header">
          <strong>
            {expandedDay.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </strong>
          <button onClick={() => setExpandedDay(null)} type="button">×</button>
        </div>
        <div className="week-expand-list">
          {goalsForDay(expandedDay).length === 0 ? (
            <span className="week-expand-empty">Nothing scheduled</span>
          ) : (
            goalsForDay(expandedDay).map((goal) => (
              <button
                key={goal.id}
                className={`week-expand-item status-${goal.status}`}
                onClick={() => { setMode('canvas'); setSelectedId(goal.id); setExpandedDay(null) }}
                type="button"
              >
                <span className="week-expand-time">
                  {goal.startAt ? goal.startAt.slice(11, 16) : 'due'}
                </span>
                <span className="week-expand-title">{goal.title}</span>
                <span className={`week-expand-dot status-dot-${goal.status}`} />
              </button>
            ))
          )}
          <button
            className="week-expand-add"
            onClick={() => {
              setExpandedDay(null)
              openDraft('', { startAt: startAtDefault, durationLabel: '1 hour' })
            }}
            type="button"
          >
            + Add task
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="command-app">

      {/* ── Mobile top bar ─────────────────────────────────────────── */}
      {isMobile && (
        <header className="mobile-topbar">
          <span className="mobile-topbar-brand">KH Personal</span>
          <span className="mobile-topbar-status">{syncLabel} · {goals.length} nodes</span>
          <button className="mobile-topbar-new" onClick={() => openDraft()} type="button">+ New</button>
        </header>
      )}

      {/* ── Desktop left rail ────────────────────────────────────────── */}
      <aside className="command-rail command-rail-left">
        <div className="control-stack chrome-control">
          <button className={mode === 'canvas' ? 'is-active' : ''} onClick={() => setMode('canvas')} type="button">Graph</button>
          <button className={mode === 'calendar' ? 'is-active' : ''} onClick={() => setMode('calendar')} type="button">Calendar</button>
          <button onClick={() => openDraft()} type="button">New</button>
        </div>

        <div className="metric-strip chrome-control">
          <span>{syncLabel}</span>
          <strong>{goals.length}</strong>
          <span>nodes</span>
          <strong>{activeGoals.length}</strong>
          <span>active</span>
        </div>

        {mode === 'canvas' && (
          <div className="control-stack chrome-control">
            <button
              className={showMicro ? 'is-active' : ''}
              onClick={() => setShowMicro((v) => !v)}
              title="Toggle day/minute-horizon tasks on the canvas"
              type="button"
            >
              {showMicro ? 'All tasks' : 'Goals only'}
            </button>
          </div>
        )}

        <PushControls />
      </aside>

      {/* ── Main content stage ──────────────────────────────────────── */}
      <main className="command-stage">
        {mode === 'canvas' ? (
          <section
            className={`canvas-shell ${dragging?.type === 'pan' ? 'is-panning' : ''}`}
            onMouseDown={beginPan}
            onMouseLeave={endDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onTouchEnd={endTouchPan}
            onTouchMove={moveTouchPan}
            onTouchStart={beginTouchPan}
            onWheel={handleWheel}
            ref={canvasRef}
          >
            <div
              className="canvas-world"
              style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
            >
              <svg className="canvas-links" height="2400" overflow="visible" viewBox="0 0 2400 2400" width="2400">
                {visibleGoals.map((goal) => {
                  const parent = goals.find((item) => item.id === goal.parentId)
                  if (!parent || !visibleIds.has(parent.id)) return null

                  const startX = (parent.x ?? VIEWPORT_CENTER.x) + NODE_WIDTH
                  const startY = (parent.y ?? VIEWPORT_CENTER.y) + NODE_HEIGHT / 2
                  const endX = goal.x ?? VIEWPORT_CENTER.x
                  const endY = (goal.y ?? VIEWPORT_CENTER.y) + NODE_HEIGHT / 2

                  const rawDx = (endX - startX) * BEZIER_STRENGTH
                  const dx = rawDx > 0 ? Math.max(rawDx, 60) : Math.min(rawDx, -60)
                  const cp1x = startX + dx
                  const cp2x = endX - dx

                  return (
                    <path
                      d={`M ${startX} ${startY} C ${cp1x} ${startY}, ${cp2x} ${endY}, ${endX} ${endY}`}
                      key={`${parent.id}-${goal.id}`}
                    />
                  )
                })}
              </svg>

              {visibleGoals.map((goal) => (
                <article
                  className={`canvas-node status-${goal.status} ${selectedId === goal.id ? 'is-selected' : ''}`}
                  key={goal.id}
                  onMouseDown={(event) => beginNodeDrag(event, goal)}
                  style={{ left: goal.x ?? VIEWPORT_CENTER.x, top: goal.y ?? VIEWPORT_CENTER.y }}
                >
                  <button
                    aria-label={goal.status === 'done' ? 'Mark active' : 'Mark complete'}
                    className="node-check"
                    onClick={(event) => { event.stopPropagation(); toggleDone(goal) }}
                    onMouseDown={(event) => event.stopPropagation()}
                    type="button"
                  >
                    {goal.status === 'done' ? '✓' : ''}
                  </button>
                  <button
                    className="node-hit"
                    onClick={() => { setSelectedId(goal.id); if (isMobile) setSheetOpen(true) }}
                    type="button"
                  >
                    <span>{durationCopy(goal)}</span>
                    <strong>{goal.title}</strong>
                    <small><b>{statusCopy(goal.status)}</b> / P{goal.priority}</small>
                  </button>
                  <div className="node-actions chrome-control">
                    <button
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={() => updateGoal(goal.id, { collapsed: !goal.collapsed })}
                      type="button"
                    >
                      {goal.collapsed ? 'Expand' : 'Collapse'}
                    </button>
                    <button onMouseDown={(event) => event.stopPropagation()} onClick={() => openDraft(goal.id)} type="button">Child</button>
                  </div>
                </article>
              ))}
            </div>

            {goals.length === 0 && (
              <div className="blank-slate chrome-control">
                <p>Empty system</p>
                <button onClick={() => openDraft()} type="button">Create first node</button>
              </div>
            )}

            {isMobile && (
              <div className="zoom-float">
                <button onClick={() => zoomBy(0.12)} type="button">+</button>
                <button onClick={() => zoomBy(-0.12)} type="button">−</button>
                <button onClick={autoLayout} disabled={goals.length === 0} type="button">⊞</button>
              </div>
            )}
          </section>

        ) : mode === 'list' ? (
          /* ── Mobile list view ─────────────────────────────────────── */
          <div className="mobile-list">
            {flatGoals.length === 0 ? (
              <div className="blank-slate chrome-control">
                <p>Empty system</p>
                <button onClick={() => openDraft()} type="button">Create first node</button>
              </div>
            ) : (
              flatGoals.map((goal) => (
                <div
                  className={`mobile-list-item status-${goal.status} ${selectedId === goal.id ? 'is-selected' : ''}`}
                  key={goal.id}
                  style={{ paddingLeft: `${16 + goal.depth * 18}px` }}
                >
                  <span className="mobile-list-status" />
                  <button
                    aria-label={goal.status === 'done' ? 'Mark active' : 'Mark complete'}
                    className="mobile-list-check"
                    onClick={() => toggleDone(goal)}
                    type="button"
                  >
                    {goal.status === 'done' ? '✓' : ''}
                  </button>
                  <button
                    className="mobile-list-content"
                    onClick={() => { setSelectedId(goal.id); setSheetOpen(true) }}
                    type="button"
                  >
                    <span className="mobile-list-title">{goal.title}</span>
                    <span className="mobile-list-meta">{durationCopy(goal)} · P{goal.priority}</span>
                  </button>
                </div>
              ))
            )}
          </div>

        ) : calendarSubMode === 'week' ? (
          /* ── Week calendar ───────────────────────────────────────── */
          <section className="calendar-shell week-shell">
            <div className="calendar-top chrome-control">
              <button onClick={() => setCalendarSubMode('month')} type="button">Month</button>
              <button onClick={() => setWeekStart((s) => stepWeek(s, -1))} type="button">‹</button>
              <strong>{weekLabel}</strong>
              <button onClick={() => setWeekStart((s) => stepWeek(s, 1))} type="button">›</button>
              <button onClick={() => setWeekStart(getWeekStart(new Date()))} type="button">Today</button>
            </div>

            {/* Day column headers — click to expand */}
            <div className="week-header">
              <div className="week-gutter-spacer" />
              {currentWeekDays.map((day) => {
                const key = dateKey(day)
                const isToday = key === todayKey
                const isExpanded = expandedDay && dateKey(expandedDay) === key
                const count = goalsForDay(day).length
                return (
                  <button
                    key={key}
                    className={`week-day-head ${isToday ? 'is-today' : ''} ${isExpanded ? 'is-expanded' : ''}`}
                    onClick={() => toggleExpandedDay(day)}
                    type="button"
                  >
                    <span className="week-day-name">{DAY_NAMES_SHORT[dayOfWeekIndex(day)]}</span>
                    <strong className="week-day-num">{day.getDate()}</strong>
                    {count > 0 && <span className="week-day-badge">{count}</span>}
                  </button>
                )
              })}
            </div>

            <DayExpandPanel />

            {/* All-day strip: tasks with dueDate only (no startAt) */}
            {(() => {
              const allDayGoals = currentWeekDays.flatMap((day) => {
                const key = dateKey(day)
                return goals
                  .filter((g) => g.dueDate === key && !g.startAt)
                  .map((g) => ({ goal: g, dayKey: key }))
              })
              if (allDayGoals.length === 0) return null
              return (
                <div className="week-allday-row">
                  <div className="week-gutter-spacer week-allday-label">due</div>
                  {currentWeekDays.map((day) => {
                    const key = dateKey(day)
                    const chips = allDayGoals.filter((x) => x.dayKey === key)
                    return (
                      <div key={key} className="week-allday-cell">
                        {chips.map(({ goal }) => (
                          <button
                            key={goal.id}
                            className={`week-allday-chip status-${goal.status}`}
                            onClick={() => { setMode('canvas'); setSelectedId(goal.id) }}
                            type="button"
                          >
                            {goal.title}
                          </button>
                        ))}
                      </div>
                    )
                  })}
                </div>
              )
            })()}

            {/* Scrollable time grid */}
            <div className="week-scroll" ref={weekScrollRef}>
              <div className="week-grid">
                <div className="week-time-col">
                  {Array.from({ length: WEEK_HOUR_END - WEEK_HOUR_START }, (_, i) => (
                    <div key={i} className="week-hour-label" style={{ height: WEEK_HOUR_PX }}>
                      {String(WEEK_HOUR_START + i).padStart(2, '0')}:00
                    </div>
                  ))}
                </div>

                {currentWeekDays.map((day) => {
                  const key = dateKey(day)
                  const isToday = key === todayKey
                  const timedGoals = goals.filter((g) => g.startAt && g.startAt.slice(0, 10) === key)
                  return (
                    <div
                      key={key}
                      className={`week-day-col ${isToday ? 'is-today' : ''}`}
                      style={{ height: (WEEK_HOUR_END - WEEK_HOUR_START) * WEEK_HOUR_PX }}
                    >
                      {Array.from({ length: WEEK_HOUR_END - WEEK_HOUR_START }, (_, i) => (
                        <div key={i} className="week-hour-line" style={{ top: i * WEEK_HOUR_PX }} />
                      ))}
                      {timedGoals.map((goal) => (
                        <button
                          key={goal.id}
                          className={`week-block status-${goal.status} ${selectedId === goal.id ? 'is-selected' : ''}`}
                          style={{ top: goalBlockTop(goal.startAt), height: goalBlockHeight(goal.startAt, goal.endAt) }}
                          onClick={() => { setMode('canvas'); setSelectedId(goal.id) }}
                          type="button"
                        >
                          <strong className="week-block-title">{goal.title}</strong>
                          <span className="week-block-time">
                            {goal.startAt.slice(11, 16)}
                            {goal.endAt ? `–${goal.endAt.slice(11, 16)}` : ''}
                          </span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

        ) : (
          /* ── Month calendar ───────────────────────────────────────── */
          <section className="calendar-shell month-shell">
            <div className="calendar-top chrome-control">
              <button onClick={() => setCalendarSubMode('week')} type="button">Week</button>
              <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))} type="button">‹</button>
              <strong>{calendarDate.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
              <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))} type="button">›</button>
            </div>
            <div className="calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="calendar-label" key={day}>{day}</span>)}
              {monthDays.map((day) => {
                const key = dateKey(day)
                const dayGoals = goalsForDay(day)
                const muted = day.getMonth() !== calendarDate.getMonth()
                const isToday = key === todayKey
                const isExpanded = expandedDay && dateKey(expandedDay) === key

                return (
                  <div
                    className={`calendar-cell ${muted ? 'is-muted' : ''} ${isToday ? 'is-today' : ''}`}
                    key={day.toISOString()}
                  >
                    <button
                      className={`calendar-day-num ${isExpanded ? 'is-expanded' : ''}`}
                      onClick={() => toggleExpandedDay(day)}
                      type="button"
                    >
                      {day.getDate()}
                    </button>
                    {dayGoals.map((goal) => (
                      <button
                        key={goal.id}
                        className={`calendar-goal-chip status-${goal.status}`}
                        onClick={() => { setMode('canvas'); setSelectedId(goal.id); if (isMobile) setSheetOpen(true) }}
                        type="button"
                      >
                        {goal.startAt ? `${goal.startAt.slice(11, 16)} ` : ''}{goal.title}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
            <DayExpandPanel />
          </section>
        )}
      </main>

      {/* ── Desktop right rail ───────────────────────────────────────── */}
      <aside className="command-rail command-rail-right">
        <div className="control-stack chrome-control">
          <button onClick={() => zoomBy(0.12)} type="button">Zoom +</button>
          <button onClick={() => zoomBy(-0.12)} type="button">Zoom -</button>
          <button onClick={resetView} type="button">Center</button>
          <button onClick={autoLayout} type="button" disabled={goals.length === 0}>Layout</button>
        </div>

        <div className="inspector chrome-control">
          {selectedGoal ? (
            <>
              <span>{getLineage(goals, selectedGoal).map((goal) => goal.title).join(' / ')}</span>
              <button
                className={`completion-toggle ${selectedGoal.status === 'done' ? 'is-complete' : ''}`}
                onClick={() => toggleDone(selectedGoal)}
                type="button"
              >
                <i>{selectedGoal.status === 'done' ? '✓' : ''}</i>
                {selectedGoal.status === 'done' ? 'Complete' : 'Mark complete'}
              </button>
              <input
                value={inspectorDraft.title}
                onBlur={commitInspectorDraft}
                onChange={(event) => setInspectorDraft((draft) => ({ ...draft, title: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
              />
              <textarea
                onBlur={commitInspectorDraft}
                onChange={(event) => setInspectorDraft((draft) => ({ ...draft, description: event.target.value }))}
                placeholder="Notes"
                rows={4}
                value={inspectorDraft.description}
              />
              <label>
                Duration
                <input
                  placeholder="e.g. 45 min, 3 weeks, Spring 2027"
                  value={inspectorDraft.durationLabel}
                  onBlur={commitInspectorDraft}
                  onChange={(event) => setInspectorDraft((draft) => ({ ...draft, durationLabel: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                />
              </label>
              <select value={selectedGoal.status} onChange={(event) => updateGoal(selectedGoal.id, { status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <label>
                Due
                <input type="date" value={selectedGoal.dueDate ?? ''} onChange={(event) => updateGoal(selectedGoal.id, { dueDate: event.target.value })} />
              </label>
              <label>
                Start
                <div className="inspector-row">
                  <input
                    type="datetime-local"
                    value={selectedGoal.startAt ?? ''}
                    onChange={(event) => updateGoal(selectedGoal.id, { startAt: event.target.value })}
                  />
                  <button onClick={() => scheduleToday(selectedGoal.id)} title="Schedule for today at 9am" type="button">Today</button>
                </div>
              </label>
              <label>
                End
                <input type="datetime-local" value={selectedGoal.endAt ?? ''} onChange={(event) => updateGoal(selectedGoal.id, { endAt: event.target.value })} />
              </label>
              <label>
                Priority
                <input max="5" min="1" type="range" value={selectedGoal.priority} onChange={(event) => updateGoal(selectedGoal.id, { priority: Number(event.target.value) })} />
              </label>
              <button onClick={() => openDraft(selectedGoal.id)} type="button">Create subgoal</button>
              <button className="danger" onClick={() => deleteGoal(selectedGoal.id)} type="button">Delete branch</button>
            </>
          ) : (
            <p>Select a node.</p>
          )}
        </div>
      </aside>

      {/* ── Mobile bottom tab bar ──────────────────────────────────────── */}
      {isMobile && (
        <nav className="mobile-tabs">
          <button className={mode === 'canvas' ? 'is-active' : ''} onClick={() => setMode('canvas')} type="button">Graph</button>
          <button className={mode === 'list' ? 'is-active' : ''} onClick={() => setMode('list')} type="button">List</button>
          <button className={mode === 'calendar' ? 'is-active' : ''} onClick={() => setMode('calendar')} type="button">Calendar</button>
        </nav>
      )}

      {/* ── Draft / new goal panel ─────────────────────────────────────── */}
      {draftOpen && (
        <div className="draft-backdrop">
          <form className="draft-panel chrome-control" onSubmit={createGoal}>
            <div>
              <span>New node</span>
              <button onClick={() => setDraftOpen(false)} type="button">Close</button>
            </div>
            <input
              autoFocus
              placeholder="Goal title"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
            <textarea
              placeholder="Definition, constraints, evidence"
              rows={4}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
            <select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
              <option value="">No parent</option>
              {flatGoals.map((goal) => (
                <option key={goal.id} value={goal.id}>{'  '.repeat(goal.depth)}{goal.title}</option>
              ))}
            </select>
            <div className="draft-grid">
              <input
                placeholder="Duration: 45 min, 3 weeks, 5 years"
                value={form.durationLabel}
                onChange={(event) => setForm({ ...form, durationLabel: event.target.value })}
              />
              <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              <input type="datetime-local" title="Scheduled start" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} />
              <input type="datetime-local" title="Scheduled end" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} />
              <input max="5" min="1" type="range" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} />
            </div>
            <button className="prime" type="submit">Create</button>
          </form>
        </div>
      )}

      {/* ── Mobile bottom sheet inspector ─────────────────────────────── */}
      {isMobile && sheetOpen && selectedGoal && (
        <>
          <div className="bottom-sheet-backdrop" onClick={() => setSheetOpen(false)} />
          <div className="bottom-sheet">
            <div className="sheet-handle" onClick={() => setSheetOpen(false)}>
              <i />
            </div>
            <div className="sheet-inner">
              <div className="sheet-path">
                {getLineage(goals, selectedGoal).map((goal) => goal.title).join(' / ')}
              </div>
              <button
                className={`completion-toggle ${selectedGoal.status === 'done' ? 'is-complete' : ''}`}
                onClick={() => toggleDone(selectedGoal)}
                type="button"
              >
                <i>{selectedGoal.status === 'done' ? '✓' : ''}</i>
                {selectedGoal.status === 'done' ? 'Complete' : 'Mark complete'}
              </button>
              <input
                value={inspectorDraft.title}
                onBlur={commitInspectorDraft}
                onChange={(event) => setInspectorDraft((draft) => ({ ...draft, title: event.target.value }))}
                onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                placeholder="Title"
              />
              <select value={selectedGoal.status} onChange={(event) => updateGoal(selectedGoal.id, { status: event.target.value })}>
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>{label}</option>
                ))}
              </select>
              <label>
                Duration
                <input
                  placeholder="e.g. 45 min, 3 weeks, Spring 2027"
                  value={inspectorDraft.durationLabel}
                  onBlur={commitInspectorDraft}
                  onChange={(event) => setInspectorDraft((draft) => ({ ...draft, durationLabel: event.target.value }))}
                  onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur() }}
                />
              </label>
              <label>
                Due
                <input
                  type="date"
                  value={selectedGoal.dueDate ?? ''}
                  onChange={(event) => updateGoal(selectedGoal.id, { dueDate: event.target.value })}
                />
              </label>
              <label>
                Start
                <input
                  type="datetime-local"
                  value={selectedGoal.startAt ?? ''}
                  onChange={(event) => updateGoal(selectedGoal.id, { startAt: event.target.value })}
                />
              </label>
              <label>
                Priority
                <input
                  max="5"
                  min="1"
                  type="range"
                  value={selectedGoal.priority}
                  onChange={(event) => updateGoal(selectedGoal.id, { priority: Number(event.target.value) })}
                />
              </label>
              <textarea
                onBlur={commitInspectorDraft}
                onChange={(event) => setInspectorDraft((draft) => ({ ...draft, description: event.target.value }))}
                placeholder="Notes"
                rows={3}
                value={inspectorDraft.description}
              />
              <div className="sheet-row-actions">
                <button onClick={() => { setSheetOpen(false); openDraft(selectedGoal.id) }} type="button">
                  + Sub-goal
                </button>
                <button className="danger" onClick={() => { deleteGoal(selectedGoal.id); setSheetOpen(false) }} type="button">
                  Delete ×
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default PersonalPage
