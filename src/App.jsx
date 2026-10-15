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

const VIEW_NAMES = { chase: 'chase cam', cockpit: 'cockpit', cinematic: 'cinematic', orbit: 'orbit' }

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
  const [state, setState] = useState({ mode: 'chase', sound: false, paused: false, title: true })
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
      put('coins', String(h.coins))
      const cls = 'speedo' + (h.boost > 0 ? ' boosting' : '') + (mph > 1e6 ? ' wild' : '')
      if (hud.current.root && shown.cls !== cls) { hud.current.root.className = cls; shown.cls = cls }
    }
    engine.onPop = p => {
      const id = ++popId
      const tilt = (Math.random() - 0.5) * 16
      setPops(ps => [...ps.slice(-5), { ...p, id, tilt }])
      setTimeout(() => setPops(ps => ps.filter(q => q.id !== id)), 1400)
    }
    engine.onTier = name => setTier({ name, id: ++tierId })
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  const eng = () => engineRef.current
  const hold = dir => ({
    onPointerDown: e => { e.currentTarget.setPointerCapture?.(e.pointerId); const en = eng(); if (en) { en.input.virtualThrottle = dir; if (en.state.title) en.emit({ title: false }) } },
    onPointerUp: () => { if (eng()) eng().input.virtualThrottle = 0 },
    onPointerCancel: () => { if (eng()) eng().input.virtualThrottle = 0 },
  })

  return (
    <div className={'stage' + (state.paused ? ' paused' : '')}>
      <canvas ref={canvasRef} className="scene" />

      <button className="mono" onClick={() => eng()?.togglePause()} aria-label="About and pause">kh</button>

      <div className="coins" aria-hidden="true"><i className="coin" /><span>×</span><b ref={el => { hud.current.coins = el }}>0</b></div>

      {!isTouch && !state.paused && (
        <div className="hint left">
          <span><kbd>←→</kbd> turn <kbd>↑↓</kbd> pitch</span>
          <span><kbd>space</kbd> boost <kbd>shift</kbd> brake</span>
          <span><kbd>q e</kbd> roll <kbd>←←</kbd> barrel roll</span>
        </div>
      )}
      {!isTouch && !state.paused && (
        <div className="hint right">
          <span><kbd>v</kbd> {VIEW_NAMES[state.mode]}</span>
          <span><kbd>m</kbd> sound {state.sound ? 'on' : 'off'}</span>
          <span><kbd>r</kbd> respawn <kbd>esc</kbd> pause</span>
        </div>
      )}
      {isTouch && !state.paused && (
        <>
          <div className="touch-hint">drag anywhere to steer</div>
          <div className="touch right">
            <button className="big boost" {...hold(1)}>boost</button>
            <button className="big brake" {...hold(-1)}>brake</button>
          </div>
          <div className="touch top">
            <button onClick={() => eng()?.cycleView()}>view</button>
            <button onClick={() => eng()?.toggleSound()}>{state.sound ? 'mute' : 'sound'}</button>
            <button onClick={() => eng()?.respawn()}>reset</button>
          </div>
        </>
      )}

      <div className="speedo" ref={el => { hud.current.root = el }} aria-hidden="true">
        <svg className="gauge" viewBox="0 0 60 60">
          <circle className="face" cx="30" cy="30" r="27" />
          <path className="arc" d={`M ${polar(-135, 23).join(' ')} A 23 23 0 1 1 ${polar(135, 23).join(' ')}`} />
          {TICKS.map(a => {
            const [x1, y1] = polar(a, 18), [x2, y2] = polar(a, 23)
            return <line key={a} className={a > 90 ? 'tick red' : 'tick'} x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
          <line className="needle" x1="30" y1="33" x2="30" y2="10" ref={el => { hud.current.needle = el }} transform="rotate(-135 30 30)" />
          <circle className="hub" cx="30" cy="30" r="3.2" />
        </svg>
        <div className="readout">
          <div className="speed"><b ref={el => { hud.current.num = el }}>139</b> <span ref={el => { hud.current.unit = el }}>mph</span></div>
          <small ref={el => { hud.current.status = el }} />
        </div>
      </div>

      {state.title && !state.paused && (
        <div className="title" aria-hidden="true">
          <div className="logo"><span className="name">kai howard</span><span className="sixtyfour">64</span></div>
          <div className="press">{isTouch ? 'touch to fly' : 'press any key to fly'}</div>
        </div>
      )}
      <div key={state.mode} className="flash">{VIEW_NAMES[state.mode]}</div>
      {tier && <div key={tier.id} className="tier">{tier.name}</div>}
      {pops.map(p => (
        <span key={p.id} className={'pop ' + p.kind} style={{ left: p.x, top: p.y, '--tilt': `${p.tilt}deg` }}>{p.text}</span>
      ))}

      {state.paused && (
        <div className="pause-wrap" onClick={() => eng()?.togglePause(false)}>
          <div className="pause" onClick={e => e.stopPropagation()}>
            <div className="pause-title">pause</div>
            <h1>kaihoward.com</h1>
            <a className="mail" href="mailto:kaihoward106@gmail.com">kaihoward106@gmail.com</a>
            <nav>
              {projects.map(p => (
                <a key={p.href} href={p.href} target="_blank" rel="noreferrer">
                  <span>{p.name}</span><small>{p.domain}</small>
                </a>
              ))}
            </nav>
            <button className="resume" onClick={() => eng()?.togglePause(false)}>resume</button>
          </div>
        </div>
      )}

      <div ref={fadeRef} className="fade" />
    </div>
  )
}
