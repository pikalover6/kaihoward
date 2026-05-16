import { useEffect, useMemo, useRef, useState } from 'react'

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

function getDepth(goals, goal) {
  return getLineage(goals, goal).length - 1
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

function statusCopy(status) {
  return STATUS_LABELS[status] ?? 'Planned'
}

function durationCopy(goal) {
  return goal.durationLabel || DURATION_FALLBACKS[goal.horizon] || goal.horizon || 'Custom'
}

function PersonalPage() {
  const [goals, setGoals] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState('canvas')
  const [status, setStatus] = useState('loading')
  const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 0.9 })
  const [dragging, setDragging] = useState(null)
  const [draftOpen, setDraftOpen] = useState(false)
  const [calendarDate, setCalendarDate] = useState(new Date())
  const [form, setForm] = useState({
    title: '',
    description: '',
    parentId: '',
    durationLabel: '',
    status: 'planned',
    priority: 3,
    dueDate: '',
  })
  const [inspectorDraft, setInspectorDraft] = useState({
    title: '',
    description: '',
    durationLabel: '',
  })
  const canvasRef = useRef(null)

  const selectedGoal = goals.find((goal) => goal.id === selectedId) ?? null
  const visibleGoals = useMemo(() => getVisibleCanvasGoals(goals), [goals])
  const visibleIds = useMemo(() => new Set(visibleGoals.map((goal) => goal.id)), [visibleGoals])
  const flatGoals = useMemo(() => flattenGoals(goals), [goals])
  const activeGoals = goals.filter((goal) => goal.status !== 'done')
  const monthDays = useMemo(() => monthMatrix(calendarDate), [calendarDate])

  useEffect(() => {
    async function loadGoals() {
      setStatus('loading')

      try {
        const response = await fetch('/personal/api/goals')

        if (!response.ok) {
          throw new Error('Could not load goals')
        }

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
  // Keep focused inspector text stable while async saves update the selected goal.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGoal?.id])

  function openDraft(parentId = '') {
    const parent = goals.find((goal) => goal.id === parentId)

    setForm({
      title: '',
      description: '',
      parentId,
      durationLabel: parent ? '' : '1 year',
      status: 'planned',
      priority: parent ? Math.max(1, parent.priority - 1) : 3,
      dueDate: '',
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

      if (!response.ok) {
        throw new Error('Could not save goal')
      }

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

      if (!response.ok) {
        throw new Error('Could not update goal')
      }

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

    if (Object.keys(updates).length > 0) {
      updateGoal(selectedGoal.id, updates)
    }
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

  function autoLayout() {
    let row = 0
    const nextGoals = goals.map((goal) => {
      const depth = getDepth(goals, goal)
      const siblings = getChildren(goals, goal.parentId)
      const siblingIndex = siblings.findIndex((item) => item.id === goal.id)

      if (siblingIndex === 0 || !goal.parentId) row += 1

      return {
        ...goal,
        x: VIEWPORT_CENTER.x + depth * TREE_X_GAP,
        y: 160 + row * TREE_Y_GAP + siblingIndex * 24,
      }
    })

    setGoals(nextGoals)
    nextGoals.forEach((goal) => updateGoal(goal.id, { x: goal.x, y: goal.y }))
  }

  function goalsForDay(day) {
    const key = dateKey(day)
    return goals.filter((goal) => goal.dueDate === key)
  }

  const syncLabel = status === 'loading' ? 'syncing' : status === 'saving' ? 'saving' : status === 'offline' ? 'local' : 'synced'

  return (
    <div className="command-app">
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
      </aside>

      <main className="command-stage">
        {mode === 'canvas' ? (
          <section
            className={`canvas-shell ${dragging?.type === 'pan' ? 'is-panning' : ''}`}
            onMouseDown={beginPan}
            onMouseLeave={endDrag}
            onMouseMove={moveDrag}
            onMouseUp={endDrag}
            onWheel={handleWheel}
            ref={canvasRef}
          >
            <div
              className="canvas-world"
              style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
            >
              <svg className="canvas-links" height="2400" viewBox="0 0 2400 2400" width="2400">
                {visibleGoals.map((goal) => {
                  const parent = goals.find((item) => item.id === goal.parentId)
                  if (!parent || !visibleIds.has(parent.id)) return null

                  const startX = (parent.x ?? VIEWPORT_CENTER.x) + NODE_WIDTH
                  const startY = (parent.y ?? VIEWPORT_CENTER.y) + NODE_HEIGHT / 2
                  const endX = goal.x ?? VIEWPORT_CENTER.x
                  const endY = (goal.y ?? VIEWPORT_CENTER.y) + NODE_HEIGHT / 2
                  const midX = startX + (endX - startX) / 2

                  return (
                    <path
                      d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
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
                  <button className="node-hit" onClick={() => setSelectedId(goal.id)} type="button">
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
          </section>
        ) : (
          <section className="calendar-shell">
            <div className="calendar-top chrome-control">
              <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() - 1, 1))} type="button">Prev</button>
              <strong>{calendarDate.toLocaleString(undefined, { month: 'long', year: 'numeric' })}</strong>
              <button onClick={() => setCalendarDate(new Date(calendarDate.getFullYear(), calendarDate.getMonth() + 1, 1))} type="button">Next</button>
            </div>
            <div className="calendar-grid">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="calendar-label" key={day}>{day}</span>)}
              {monthDays.map((day) => {
                const dayGoals = goalsForDay(day)
                const muted = day.getMonth() !== calendarDate.getMonth()

                return (
                  <div className={`calendar-cell ${muted ? 'is-muted' : ''}`} key={day.toISOString()}>
                    <span>{day.getDate()}</span>
                    {dayGoals.map((goal) => (
                      <button key={goal.id} onClick={() => { setMode('canvas'); setSelectedId(goal.id) }} type="button">
                        {goal.title}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </section>
        )}
      </main>

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
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.currentTarget.blur()
                  }
                }}
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
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
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
              <input max="5" min="1" type="range" value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })} />
            </div>
            <button className="prime" type="submit">Create</button>
          </form>
        </div>
      )}
    </div>
  )
}

export default PersonalPage
