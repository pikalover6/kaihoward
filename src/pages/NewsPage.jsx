import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import './News.css'

const API = '/news/api'

const longDate = (iso) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

async function getJSON(path) {
  const res = await fetch(`${API}${path}`)
  if (!res.ok) throw new Error(`${res.status}`)
  return res.json()
}

function Masthead({ dateIso }) {
  return (
    <header className="kc-masthead">
      <Link to="/news" className="kc-title">
        THE KAI COURIER
      </Link>
      <div className="kc-rule" />
      <div className="kc-meta">
        <span>{longDate(dateIso ?? new Date().toISOString().slice(0, 10))}</span>
        <nav className="kc-nav">
          <Link to="/news">Today</Link>
          <span aria-hidden> · </span>
          <Link to="/news/archive">Archive</Link>
        </nav>
      </div>
    </header>
  )
}

function ArticleView({ date }) {
  const [article, setArticle] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    setArticle(null)
    setError(null)
    getJSON(`/${date ?? 'today'}`)
      .then(setArticle)
      .catch((e) => setError(e.message))
  }, [date])

  return (
    <div className="kc-paper">
      <Masthead dateIso={article?.date ?? date} />
      <main>
        {error && (
          <div className="kc-state">
            <p>No edition found{date ? ` for ${date}` : ''}.</p>
            <p className="kc-muted">The presses may not have run yet today.</p>
          </div>
        )}
        {!error && !article && <div className="kc-state kc-muted">Setting type…</div>}
        {article && (
          <article
            className="kc-broadsheet"
            dangerouslySetInnerHTML={{ __html: article.html }}
          />
        )}
      </main>
      <Colophon />
    </div>
  )
}

function ArchiveView() {
  const [items, setItems] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getJSON('/archive')
      .then(setItems)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <div className="kc-paper">
      <Masthead />
      <main>
        <h2 className="kc-section-label">Back Issues</h2>
        {error && <div className="kc-state kc-muted">Could not load the archive.</div>}
        {!error && !items && <div className="kc-state kc-muted">Pulling the morgue files…</div>}
        {items && items.length === 0 && (
          <div className="kc-state kc-muted">No back issues yet.</div>
        )}
        {items && items.length > 0 && (
          <ul className="kc-archive">
            {items.map((it) => (
              <li key={it.date}>
                <Link to={`/news/${it.date}`}>
                  <span className="kc-archive-date">{longDate(it.date)}</span>
                  {it.summary && <span className="kc-archive-summary">{it.summary}</span>}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Colophon />
    </div>
  )
}

function Colophon() {
  return (
    <footer className="kc-colophon">
      Published daily for Kai · Set in Playfair Display &amp; Source Serif 4
    </footer>
  )
}

export default function NewsPage({ view }) {
  const { date } = useParams()
  return view === 'archive' ? <ArchiveView /> : <ArticleView date={date} />
}
