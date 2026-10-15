import { useEffect, useRef, useState } from 'react'
import { Engine } from './sim/engine.js'
import { MPH } from './sim/units.js'
import './App.css'

const projects = [
  { name: 'Terrainist', domain: 'github.com', href: 'https://github.com/pikalover6/terrainist' },
  { name: 'GPT-2 Whisperer', domain: 'pikalover6.github.io', href: 'https://pikalover6.github.io/gpt2whisperer/' },
  { name: 'Claude Subagents Effort', domain: 'github.com', href: 'https://github.com/pikalover6/claude-subagents-effort' },
  { name: 'totally-not-an-llm', domain: 'huggingface.co', href: 'https://huggingface.co/totally-not-an-llm' },
]

const VIEW_NAMES = { chase: 'chase', cockpit: 'cockpit', cinematic: 'cinematic', orbit: 'orbit' }

// the speedometer reads honestly up to here; past it the needle just goes round
const GAUGE_MAX = 300
const polar = (deg, r) => [30 + r * Math.sin(deg * Math.PI / 180), 30 - r * Math.cos(deg * Math.PI / 180)]
const TICKS = Array.from({ length: 11 }, (_, i) => -135 + 27 * i)

let popId = 0, tierId = 0

export default function App() {
  const canvasRef = useRef(null)
  const fadeRef = useRef(null)
  const engineRef = useRef(null)
  const hud = useRef({})
  const [state, setState] = useState({ mode: 'chase', draw: 'off', sound: false, landing: false, engine: true })
  const [card, setCard] = useState(false)
  const [pops, setPops] = useState([])
  const [tier, setTier] = useState(null)
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    const engine = new Engine(canvasRef.current, s => setState(s))
    engine.onFade = v => { if (fadeRef.current) fadeRef.current.style.opacity = v }
    let needle = -135, last = performance.now()
    const shown = {}
    const put = (key, value) => {
      const el = hud.current[key]
      if (el && shown[key] !== value) { el.textContent = value; shown[key] = value }
    }
    engine.onHud = h => {
      const now = performance.now(), dt = Math.min(0.1, (now - last) / 1000)
      last = now
      const mph = h.speed * MPH
      if (mph < GAUGE_MAX) {
        const target = -135 + 270 * mph / GAUGE_MAX
        const delta = ((target - needle + 540) % 360) - 180
        needle += delta * Math.min(1, dt * 10)
      } else {
        needle += dt * 360 * Math.min(7, 0.7 + Math.log10(mph / GAUGE_MAX) * 0.9)
      }
      needle %= 360
      hud.current.needle?.setAttribute('transform', `rotate(${needle.toFixed(1)} 30 30)`)
      put('num', h.text.num)
      put('unit', h.text.unit)
      put('status', h.status)
      put('dial', h.dial ? `dial ${h.dial.num} ${h.dial.unit}` : '')
      const cls = 'speedo' + (h.engine ? '' : ' off') + (mph > 1e6 ? ' wild' : '')
      if (hud.current.root && shown.cls !== cls) { hud.current.root.className = cls; shown.cls = cls }
    }
    engine.onPop = p => {
      const id = ++popId
      const tilt = (Math.random() - 0.5) * 18
      setPops(ps => [...ps.slice(-5), { ...p, id, tilt }])
      setTimeout(() => setPops(ps => ps.filter(q => q.id !== id)), 1300)
    }
    engine.onTier = name => setTier({ name, id: ++tierId })
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
  const hold = dir => ({
    onPointerDown: e => { e.currentTarget.setPointerCapture?.(e.pointerId); if (eng()) eng().input.virtualThrottle = dir },
    onPointerUp: () => { if (eng()) eng().input.virtualThrottle = 0 },
    onPointerCancel: () => { if (eng()) eng().input.virtualThrottle = 0 },
  })

  return (
    <div className={'stage' + (drawing ? ' drawing' : '')}>
      <canvas ref={canvasRef} className="scene" />

      <button className="mono" onClick={() => setCard(c => !c)} aria-label="About">kh</button>

      {!isTouch && (
        <div className="hint left">
          <span><kbd>↑↓←→</kbd> fly</span>
          <span><kbd>q e</kbd> rudder</span>
          <span><kbd>shift ctrl</kbd> speed (no limit)</span>
          <span><kbd>space</kbd> engine {state.engine ? 'off' : 'on'}</span>
        </div>
      )}
      {!isTouch && (
        <div className="hint right">
          <span><kbd>v</kbd> view</span>
          <span><kbd>f</kbd> {drawing ? 'stop' : 'draw a path'}</span>
          <span><kbd>m</kbd> sound {state.sound ? 'on' : 'off'}</span>
          <span><kbd>r</kbd> respawn</span>
        </div>
      )}
      {isTouch && (
        <div className="touch left">
          <span className="drag">drag to fly</span>
          <button {...hold(1)}>faster</button>
          <button {...hold(-1)}>slower</button>
          <button className={state.engine ? '' : 'lit'} onClick={() => eng()?.toggleEngine()}>{state.engine ? 'engine' : 'start'}</button>
        </div>
      )}
      {isTouch && (
        <div className="touch right">
          <button onClick={() => eng()?.cycleView()}>view</button>
          <button onClick={() => eng()?.toggleDraw()}>{drawing ? 'stop' : 'draw'}</button>
          <button onClick={() => eng()?.toggleSound()}>{state.sound ? 'mute' : 'sound'}</button>
          <button onClick={() => eng()?.respawn()}>respawn</button>
        </div>
      )}

      <div className="speedo" ref={el => { hud.current.root = el }} aria-hidden="true">
        <svg className="gauge" viewBox="0 0 60 60">
          <path className="arc" d={`M ${polar(-135, 24).join(' ')} A 24 24 0 1 1 ${polar(135, 24).join(' ')}`} />
          {TICKS.map(a => {
            const [x1, y1] = polar(a, 19.5), [x2, y2] = polar(a, 24)
            return <line key={a} className={a > 90 ? 'tick red' : 'tick'} x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
          <line className="needle" x1="30" y1="33" x2="30" y2="10" ref={el => { hud.current.needle = el }} transform="rotate(-135 30 30)" />
          <circle className="hub" cx="30" cy="30" r="3" />
        </svg>
        <div className="readout">
          <div className="speed"><b ref={el => { hud.current.num = el }}>139</b> <span ref={el => { hud.current.unit = el }}>mph</span></div>
          <small ref={el => { hud.current.status = el }}>engine on</small>
          <small className="dial" ref={el => { hud.current.dial = el }} />
        </div>
      </div>

      {state.draw === 'idle' && <div className="center">draw a path</div>}
      <div key={state.mode} className="flash">{VIEW_NAMES[state.mode]}</div>
      {tier && <div key={tier.id} className="tier">{tier.name}</div>}
      {pops.map(p => (
        <span key={p.id} className={'pop ' + p.kind} style={{ left: p.x, top: p.y, '--tilt': `${p.tilt}deg` }}>{p.text}</span>
      ))}

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
