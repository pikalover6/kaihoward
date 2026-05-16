import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

function PersonalPage() {
  const [note, setNote] = useState('')
  const [status, setStatus] = useState('loading')

  useEffect(() => {
    async function loadNote() {
      setStatus('loading')

      try {
        const response = await fetch('/personal/api/note')

        if (!response.ok) {
          throw new Error('Could not load note')
        }

        const data = await response.json()
        setNote(data.content ?? '')
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }

    loadNote()
  }, [])

  async function handleSave(event) {
    event.preventDefault()
    setStatus('loading')

    try {
      const response = await fetch('/personal/api/note', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: note }),
      })

      if (!response.ok) {
        throw new Error('Could not save note')
      }

      const data = await response.json()
      setNote(data.content ?? '')
      setStatus('saved')
    } catch {
      setStatus('error')
    }
  }

  let statusText = 'Loading...'
  if (status === 'saved') statusText = 'Saved.'
  if (status === 'error') statusText = 'Error: please try again.'

  return (
    <div className="page">
      <div className="layout">
        <nav className="navbar">
          <span className="nav-brand">kaihoward.com</span>
          <div className="nav-right">
            <Link to="/" className="nav-link">Home</Link>
          </div>
        </nav>

        <div className="card">
          <div className="card-inner personal-card-inner">
            <h1 className="personal-title">Hello, Kai</h1>
            <p className="personal-subtitle">This is your private tools area.</p>

            <form onSubmit={handleSave} className="personal-form">
              <label htmlFor="personal-note" className="personal-label">Persistent note</label>
              <textarea
                id="personal-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={8}
                className="personal-textarea"
              />

              <div className="personal-actions">
                <button type="submit" className="nav-link personal-save" disabled={status === 'loading'}>
                  Save
                </button>
                <span role="status" aria-live="polite" className="personal-status">{statusText}</span>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PersonalPage
