import { useEffect, useRef, useState } from 'react'
import { Engine } from './sim/engine.js'
import './App.css'

const projects = [
  { name: 'Terrainist', domain: 'terrainist.com', href: 'https://terrainist.com/' },
  { name: 'GPT-2 Whisperer', domain: 'pikalover6.github.io', href: 'https://pikalover6.github.io/gpt2whisperer/' },
  { name: 'Claude Subagents Effort', domain: 'github.com', href: 'https://github.com/pikalover6/claude-subagents-effort' },
  { name: 'totally-not-an-llm', domain: 'huggingface.co', href: 'https://huggingface.co/totally-not-an-llm' },
]

const VIEW_NAMES = { chase: 'chase', cockpit: 'cockpit', cinematic: 'cinematic', orbit: 'orbit' }

export default function App() {
  const canvasRef = useRef(null)
  const fadeRef = useRef(null)
  const engineRef = useRef(null)
  const [state, setState] = useState({ mode: 'chase', draw: 'off', sound: false, landing: false })
  const [card, setCard] = useState(false)
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    const engine = new Engine(canvasRef.current, s => setState(s))
    engine.onFade = v => { if (fadeRef.current) fadeRef.current.style.opacity = v }
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setCard(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const eng = () => engineRef.current
  const drawing = state.draw !== 'off'

  return (
    <div className={'stage' + (drawing ? ' drawing' : '')}>
      <canvas ref={canvasRef} className="scene" />

      <button className="mono" onClick={() => setCard(c => !c)} aria-label="About">kh</button>

      {!isTouch && (
        <div className="hint left">
          <span><kbd>↑↓←→</kbd> fly</span>
          <span><kbd>q e</kbd> rudder</span>
          <span><kbd>shift ctrl</kbd> throttle</span>
          <span><kbd>space</kbd> barrel roll</span>
        </div>
      )}
      {!isTouch && (
        <div className="hint right">
          <span><kbd>v</kbd> view</span>
          <span><kbd>f</kbd> {drawing ? 'stop' : 'draw a path'}</span>
          <span><kbd>m</kbd> sound {state.sound ? 'on' : 'off'}</span>
        </div>
      )}
      {isTouch && (
        <div className="hint left"><span>drag to fly</span></div>
      )}
      {isTouch && (
        <div className="touch right">
          <button onClick={() => eng()?.cycleView()}>view</button>
          <button onClick={() => eng()?.toggleDraw()}>{drawing ? 'stop' : 'draw'}</button>
          <button onClick={() => eng()?.toggleSound()}>{state.sound ? 'mute' : 'sound'}</button>
        </div>
      )}

      {state.draw === 'idle' && <div className="center">draw a path</div>}
      <div key={state.mode} className="flash">{VIEW_NAMES[state.mode]}</div>

      {card && (
        <div className="card-wrap" onClick={() => setCard(false)}>
          <div className="card" onClick={e => e.stopPropagation()}>
            <h1>kaihoward.com</h1>
            <a className="mail" href="mailto:kaihoward106@gmail.com">kaihoward106@gmail.com</a>
            <nav>
              {projects.map(p => (
                <a key={p.href} href={p.href} target="_blank" rel="noreferrer">
                  <span>{p.name}</span><small>{p.domain}</small>
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}

      <div ref={fadeRef} className="fade" />
    </div>
  )
}
