import { useEffect, useMemo, useState } from 'react'

const HORIZONS = [
  { id: 'life', label: 'Life', span: 'North star' },
  { id: 'five-year', label: '5Y', span: 'Long arc' },
  { id: 'year', label: 'Year', span: 'Outcomes' },
  { id: 'semester', label: 'Semester', span: 'Sprints' },
  { id: 'month', label: 'Month', span: 'Milestones' },
  { id: 'week', label: 'Week', span: 'Commitments' },
  { id: 'day', label: 'Day', span: 'Actions' },
  { id: 'minute', label: 'Now', span: 'Focus' },
]

const STATUS_LABELS = {
  planned: 'Planned',
  active: 'Active',
  blocked: 'Blocked',
  done: 'Done',
}

const STARTER_GOALS = [
  {
    id: 'starter-law',
    parentId: null,
    title: 'Graduate law school',
    description: 'A long-range objective that can absorb every class, habit, exam, application, and daily work block beneath it.',
    horizon: 'life',
    status: 'active',
    priority: 5,
    dueDate: '',
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
    dueDate: '',
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
    dueDate: '',
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
    dueDate: '',
    sortOrder: 3,
  },
]

function createStarterGoal(goal) {
  return {
    ...goal,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function getChildren(goals, parentId) {
  return goals
    .filter((goal) => goal.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title))
}

function countDescendants(goals, id) {
  const children = getChildren(goals, id)
  return children.reduce((total, child) => total + 1 + countDescendants(goals, child.id), 0)
}

function getGoalDepth(goals, goal) {
  let depth = 0
  let cursor = goal

  while (cursor?.parentId) {
    cursor = goals.find((item) => item.id === cursor.parentId)
    depth += 1
  }

  return depth
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

function flattenGoals(goals, parentId = null, depth = 0) {
  return getChildren(goals, parentId).flatMap((goal) => [
    { ...goal, depth },
    ...flattenGoals(goals, goal.id, depth + 1),
  ])
}

function statusText(status) {
  return STATUS_LABELS[status] ?? 'Planned'
}

function PersonalPage() {
  const [goals, setGoals] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [activeHorizon, setActiveHorizon] = useState('all')
  const [status, setStatus] = useState('loading')
  const [panel, setPanel] = useState('plan')
  const [form, setForm] = useState({
    title: '',
    description: '',
    parentId: '',
    horizon: 'month',
    priority: 3,
    dueDate: '',
  })

  const selectedGoal = goals.find((goal) => goal.id === selectedId) ?? goals[0]
  const visibleGoals = useMemo(() => {
    const flat = flattenGoals(goals)
    return activeHorizon === 'all' ? flat : flat.filter((goal) => goal.horizon === activeHorizon)
  }, [activeHorizon, goals])
  const activeGoals = goals.filter((goal) => goal.status !== 'done')
  const doneCount = goals.length - activeGoals.length
  const focusQueue = [...activeGoals]
    .sort((a, b) => b.priority - a.priority || getGoalDepth(goals, b) - getGoalDepth(goals, a))
    .slice(0, 6)

  useEffect(() => {
    async function loadGoals() {
      setStatus('loading')

      try {
        const response = await fetch('/personal/api/goals')

        if (!response.ok) {
          throw new Error('Could not load goals')
        }

        const data = await response.json()
        const loadedGoals = data.goals ?? []
        const initialGoals = loadedGoals.length ? loadedGoals : STARTER_GOALS.map(createStarterGoal)
        setGoals(initialGoals)
        setSelectedId(initialGoals[0]?.id ?? '')
        setStatus('saved')
      } catch {
        const starter = STARTER_GOALS.map(createStarterGoal)
        setGoals(starter)
        setSelectedId(starter[0].id)
        setStatus('offline')
      }
    }

    loadGoals()
  }, [])

  async function createGoal(event) {
    event.preventDefault()

    const title = form.title.trim()

    if (!title) return

    const optimisticGoal = {
      id: crypto.randomUUID(),
      parentId: form.parentId || null,
      title,
      description: form.description.trim(),
      horizon: form.horizon,
      status: 'planned',
      priority: Number(form.priority),
      dueDate: form.dueDate,
      sortOrder: goals.length + 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    setGoals((currentGoals) => [...currentGoals, optimisticGoal])
    setSelectedId(optimisticGoal.id)
    setForm((currentForm) => ({ ...currentForm, title: '', description: '', dueDate: '' }))
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

      setStatus('saved')
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

      setStatus('saved')
    } catch {
      setStatus('offline')
    }
  }

  async function deleteGoal(id) {
    const deletedIds = new Set([id])
    let changed = true

    while (changed) {
      changed = false
      goals.forEach((goal) => {
        if (goal.parentId && deletedIds.has(goal.parentId) && !deletedIds.has(goal.id)) {
          deletedIds.add(goal.id)
          changed = true
        }
      })
    }

    const nextGoals = goals.filter((goal) => !deletedIds.has(goal.id))
    setGoals(nextGoals)
    setSelectedId(nextGoals[0]?.id ?? '')
    setStatus('saving')

    try {
      await fetch(`/personal/api/goals?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      setStatus('saved')
    } catch {
      setStatus('offline')
    }
  }

  function addChild(parentGoal, horizon) {
    setForm({
      title: '',
      description: '',
      parentId: parentGoal.id,
      horizon,
      priority: Math.max(1, parentGoal.priority - 1),
      dueDate: '',
    })
    setPanel('add')
  }

  const statusLabel = status === 'loading' ? 'Syncing' : status === 'saving' ? 'Saving' : status === 'offline' ? 'Local changes' : 'Synced'
  const selectedHorizonIndex = HORIZONS.findIndex((horizon) => horizon.id === selectedGoal?.horizon)
  const childHorizonOptions = selectedHorizonIndex >= 0 ? HORIZONS.slice(selectedHorizonIndex + 1) : HORIZONS

  return (
    <div className="personal-app">
      <aside className="personal-sidebar">
        <div className="personal-brand">
          <span className="personal-brand-mark">K</span>
          <div>
            <p>Kai OS</p>
            <span>Life goal organizer</span>
          </div>
        </div>

        <nav className="personal-tabs" aria-label="Personal app sections">
          <button className={panel === 'plan' ? 'is-active' : ''} onClick={() => setPanel('plan')} type="button">Plan</button>
          <button className={panel === 'add' ? 'is-active' : ''} onClick={() => setPanel('add')} type="button">Add</button>
          <button className={panel === 'systems' ? 'is-active' : ''} onClick={() => setPanel('systems')} type="button">Systems</button>
        </nav>

        <div className="personal-sync">
          <span className={`sync-dot sync-${status}`}></span>
          <span>{statusLabel}</span>
        </div>

        <div className="personal-stat-grid">
          <div>
            <strong>{goals.length}</strong>
            <span>Total nodes</span>
          </div>
          <div>
            <strong>{doneCount}</strong>
            <span>Complete</span>
          </div>
          <div>
            <strong>{focusQueue.length}</strong>
            <span>Focus queue</span>
          </div>
          <div>
            <strong>{HORIZONS.filter((horizon) => goals.some((goal) => goal.horizon === horizon.id)).length}</strong>
            <span>Horizons</span>
          </div>
        </div>
      </aside>

      <main className="personal-main">
        <section className="personal-topbar">
          <div>
            <p className="personal-kicker">Private dashboard</p>
            <h1>Master plan</h1>
          </div>
          <div className="personal-top-actions">
            <button type="button" onClick={() => setPanel('add')}>New goal</button>
            <a href="/">Public site</a>
          </div>
        </section>

        <section className="horizon-rail" aria-label="Goal horizons">
          <button className={activeHorizon === 'all' ? 'is-active' : ''} onClick={() => setActiveHorizon('all')} type="button">
            <strong>All</strong>
            <span>Full map</span>
          </button>
          {HORIZONS.map((horizon) => (
            <button
              className={activeHorizon === horizon.id ? 'is-active' : ''}
              key={horizon.id}
              onClick={() => setActiveHorizon(horizon.id)}
              type="button"
            >
              <strong>{horizon.label}</strong>
              <span>{horizon.span}</span>
            </button>
          ))}
        </section>

        {panel === 'add' ? (
          <section className="personal-panel add-panel">
            <div className="panel-heading">
              <div>
                <p className="personal-kicker">Capture</p>
                <h2>Add a goal node</h2>
              </div>
              <button type="button" onClick={() => setPanel('plan')}>Back to map</button>
            </div>

            <form className="goal-form" onSubmit={createGoal}>
              <label>
                <span>Title</span>
                <input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
              </label>
              <label>
                <span>Parent</span>
                <select value={form.parentId} onChange={(event) => setForm({ ...form, parentId: event.target.value })}>
                  <option value="">Top-level goal</option>
                  {flattenGoals(goals).map((goal) => (
                    <option key={goal.id} value={goal.id}>
                      {'  '.repeat(goal.depth)}{goal.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Horizon</span>
                <select value={form.horizon} onChange={(event) => setForm({ ...form, horizon: event.target.value })}>
                  {HORIZONS.map((horizon) => <option key={horizon.id} value={horizon.id}>{horizon.label}</option>)}
                </select>
              </label>
              <label>
                <span>Priority</span>
                <input
                  max="5"
                  min="1"
                  type="range"
                  value={form.priority}
                  onChange={(event) => setForm({ ...form, priority: event.target.value })}
                />
              </label>
              <label>
                <span>Due date</span>
                <input type="date" value={form.dueDate} onChange={(event) => setForm({ ...form, dueDate: event.target.value })} />
              </label>
              <label className="wide-field">
                <span>Description</span>
                <textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} rows={5} />
              </label>
              <button className="primary-action" type="submit">Add to map</button>
            </form>
          </section>
        ) : panel === 'systems' ? (
          <section className="personal-panel systems-panel">
            <div className="panel-heading">
              <div>
                <p className="personal-kicker">Scaffolding</p>
                <h2>Future command center</h2>
              </div>
            </div>
            <div className="systems-grid">
              <article>
                <span>API</span>
                <h3>ChatGPT planning assistant</h3>
                <p>Reserved for an endpoint that can turn a goal into milestones, risks, study plans, and calendar blocks.</p>
              </article>
              <article>
                <span>Notify</span>
                <h3>Reminder engine</h3>
                <p>Ready for email, push, or SMS hooks when goals need nudges, reviews, or daily planning prompts.</p>
              </article>
              <article>
                <span>Calendar</span>
                <h3>Schedule bridge</h3>
                <p>A future place to sync weeks and days with Google Calendar or another planning surface.</p>
              </article>
              <article>
                <span>Review</span>
                <h3>Reflection loops</h3>
                <p>Weekly and monthly retrospectives can attach evidence, notes, and decisions to each goal branch.</p>
              </article>
            </div>
          </section>
        ) : (
          <section className="goal-workspace">
            <div className="goal-map personal-panel">
              <div className="panel-heading">
                <div>
                  <p className="personal-kicker">Hierarchy</p>
                  <h2>Goal tree</h2>
                </div>
                <span>{visibleGoals.length} shown</span>
              </div>

              <div className="goal-tree">
                {visibleGoals.map((goal) => (
                  <button
                    className={`goal-row ${selectedGoal?.id === goal.id ? 'is-selected' : ''} status-${goal.status}`}
                    key={goal.id}
                    onClick={() => setSelectedId(goal.id)}
                    style={{ '--depth': goal.depth }}
                    type="button"
                  >
                    <span className="goal-row-line"></span>
                    <span className="goal-row-main">
                      <strong>{goal.title}</strong>
                      <small>{statusText(goal.status)} - {goal.horizon}</small>
                    </span>
                    <span className="goal-row-count">{countDescendants(goals, goal.id)}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="goal-detail personal-panel">
              {selectedGoal ? (
                <>
                  <div className="panel-heading">
                    <div>
                      <p className="personal-kicker">{selectedGoal.horizon}</p>
                      <h2>{selectedGoal.title}</h2>
                    </div>
                    <select
                      value={selectedGoal.status}
                      onChange={(event) => updateGoal(selectedGoal.id, { status: event.target.value })}
                    >
                      {Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                  </div>

                  <p className="goal-description">{selectedGoal.description || 'No description yet.'}</p>

                  <div className="goal-lineage">
                    {getLineage(goals, selectedGoal).map((goal) => <span key={goal.id}>{goal.title}</span>)}
                  </div>

                  <div className="detail-grid">
                    <div>
                      <span>Priority</span>
                      <strong>{selectedGoal.priority}/5</strong>
                    </div>
                    <div>
                      <span>Children</span>
                      <strong>{getChildren(goals, selectedGoal.id).length}</strong>
                    </div>
                    <div>
                      <span>Due</span>
                      <strong>{selectedGoal.dueDate || 'Unset'}</strong>
                    </div>
                  </div>

                  {childHorizonOptions.length > 0 && (
                    <div className="child-actions">
                      {childHorizonOptions.map((horizon) => (
                        <button key={horizon.id} type="button" onClick={() => addChild(selectedGoal, horizon.id)}>
                          Add {horizon.label}
                        </button>
                      ))}
                    </div>
                  )}

                  <button className="danger-action" type="button" onClick={() => deleteGoal(selectedGoal.id)}>Delete branch</button>
                </>
              ) : (
                <div className="empty-state">Add your first north-star goal.</div>
              )}
            </div>

            <div className="personal-panel focus-panel">
              <div className="panel-heading">
                <div>
                  <p className="personal-kicker">Execution</p>
                  <h2>Focus queue</h2>
                </div>
              </div>
              <div className="focus-list">
                {focusQueue.map((goal) => (
                  <button key={goal.id} type="button" onClick={() => setSelectedId(goal.id)}>
                    <span>{goal.horizon}</span>
                    <strong>{goal.title}</strong>
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

export default PersonalPage
