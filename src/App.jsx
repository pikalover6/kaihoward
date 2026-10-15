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

// the power meter: eight wedges, coloured by how many are left (blue, green, yellow, red)
function pieFill(hp, max) {
  const k = Math.max(0, Math.min(1, hp / max)), n = Math.ceil(hp - 1e-6)
  const col = n >= 7 ? '#1466e0' : n >= 5 ? '#1fae45' : n >= 3 ? '#f2b40c' : '#e8283e'
  const deg = (k * 360).toFixed(1)
  return `conic-gradient(${col} 0deg ${deg}deg, rgba(10, 30, 60, 0.75) ${deg}deg 360deg)`
}

let popId = 0, tierId = 0, radioId = 0, bannerId = 0

export default function App() {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const fadeRef = useRef(null)
  const engineRef = useRef(null)
  const hud = useRef({})
  const [state, setState] = useState({ mode: 'chase', sound: false, paused: false, title: true })
  const [pops, setPops] = useState([])
  const [tier, setTier] = useState(null)
  const [radio, setRadio] = useState(null)
  const [banner, setBanner] = useState(null)
  const [phase, setPhase] = useState('idle')
  const [stats, setStats] = useState({ score: 0, best: 0, kills: 0, wave: 0 })
  const isTouch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches

  useEffect(() => {
    const engine = new Engine(canvasRef.current, s => setState(s))
    engine.setOverlay(overlayRef.current)
    engine.onFade = v => { if (fadeRef.current) fadeRef.current.style.opacity = v }
    let needle = -135, last = performance.now()
    const shown = {}
    const put = (key, value) => {
      const el = hud.current[key]
      if (el && shown[key] !== value) { el.textContent = value; shown[key] = value }
    }
    const cls = (key, value) => {
      const el = hud.current[key]
      if (el && shown['c' + key] !== value) { el.className = value; shown['c' + key] = value }
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
      put('score', h.score.toLocaleString())
      put('best', h.best > 0 ? `best ${h.best.toLocaleString()}` : '')
      cls('root', 'speedo glass' + (h.boost > 0 ? ' boosting' : '') + (mph > 1e6 ? ' wild' : ''))
      // power
      const pie = pieFill(h.hp, h.maxHp)
      if (hud.current.pie && shown.pie !== pie) { hud.current.pie.style.background = pie; shown.pie = pie }
      cls('power', 'power' + (h.hp <= 2 ? ' low' : ''))
      // the wave
      let wave = ''
      if (h.phase === 'calm') wave = 'bogeys inbound…'
      else if (h.phase === 'fight') wave = `wave ${h.wave} · ${h.bandits} ${h.bandits === 1 ? 'bandit' : 'bandits'}`
      else if (h.phase === 'clear') wave = `wave ${h.wave} clear`
      put('wave', wave)
      cls('waveBox', 'wave glass' + (wave ? '' : ' hidden'))
      // warnings
      put('warn', h.warn === 'missile' ? 'missile!' : h.warn === 'lock' ? 'lock' : '')
      cls('warn', 'warn ' + (h.warn || 'none'))
      // what you're carrying
      put('triple', h.triple > 0 ? `triple ${Math.ceil(h.triple)}s` : '')
      put('ducks', h.ducks > 0 ? `ducks ×${h.ducks}` : '')
      put('shield', h.shield > 0 ? `bubble ${Math.ceil(h.shield)}s` : '')
      cls('triple', 'chip aqua' + (h.triple > 0 ? '' : ' hidden'))
      cls('ducks', 'chip yellow' + (h.ducks > 0 ? '' : ' hidden'))
      cls('shield', 'chip blue' + (h.shield > 0 ? '' : ' hidden'))
      put('combo', h.combo > 1 ? `combo ×${h.combo}` : '')
      cls('combo', 'combo' + (h.combo > 1 ? '' : ' hidden'))
      if (shown.phase !== h.phase) { shown.phase = h.phase; setPhase(h.phase) }
      const bucket = `${h.kills}/${h.wave}/${Math.floor(h.score / 100)}`
      if (shown.bucket !== bucket) { shown.bucket = bucket; setStats({ score: h.score, best: h.best, kills: h.kills, wave: h.wave }) }
    }
    engine.onPop = p => {
      const id = ++popId
      const tilt = p.kind === 'style' || p.kind === 'points' ? 0 : (Math.random() - 0.5) * 16
      setPops(ps => [...ps.slice(-7), { ...p, id, tilt }])
      setTimeout(() => setPops(ps => ps.filter(q => q.id !== id)), p.kind === 'style' || p.kind === 'points' ? 1700 : 1400)
    }
    engine.onTier = name => setTier({ name, id: ++tierId })
    engine.onRadio = r => {
      const id = ++radioId
      setRadio({ ...r, id })
      setTimeout(() => setRadio(cur => (cur && cur.id === id ? null : cur)), 1800 + r.text.length * 55)
    }
    engine.onBanner = b => {
      const id = ++bannerId
      setBanner({ ...b, id })
      setTimeout(() => setBanner(cur => (cur && cur.id === id ? null : cur)), 2800)
    }
    engineRef.current = engine
    return () => engine.dispose()
  }, [])

  const eng = () => engineRef.current
  const hold = dir => ({
    onPointerDown: e => { e.currentTarget.setPointerCapture?.(e.pointerId); const en = eng(); if (en) { en.input.virtualThrottle = dir; if (en.state.title) en.emit({ title: false }) } },
    onPointerUp: () => { if (eng()) eng().input.virtualThrottle = 0 },
    onPointerCancel: () => { if (eng()) eng().input.virtualThrottle = 0 },
  })
  const roll = () => { const en = eng(); if (en && !en.state.paused) en.flight.barrelRoll(Math.random() < 0.5 ? -1 : 1) }
  const showHints = !isTouch && !state.paused && !state.title && (phase === 'idle' || phase === 'calm')

  return (
    <div className={'stage' + (state.paused ? ' paused' : '')}>
      <canvas ref={canvasRef} className="scene" />
      <canvas ref={overlayRef} className="overlay" />

      <button className="mono gel" onClick={() => eng()?.togglePause()} aria-label="About and pause">kh</button>

      <div className="scorebox glass" aria-hidden="true">
        <div className="score"><small>score</small><b ref={el => { hud.current.score = el }}>0</b></div>
        <div className="sub">
          <span className="coins"><i className="coin" />×<b ref={el => { hud.current.coins = el }}>0</b></span>
          <span className="best" ref={el => { hud.current.best = el }} />
        </div>
        <div className="combo hidden" ref={el => { hud.current.combo = el }} />
      </div>

      <div className="wave glass hidden" ref={el => { hud.current.waveBox = el }} aria-hidden="true">
        <span ref={el => { hud.current.wave = el }} />
      </div>
      <div className="warn none" ref={el => { hud.current.warn = el }} aria-hidden="true" />

      {radio && (
        <div key={radio.id} className="radio glass" aria-live="polite">
          <span className="who"><i className="led" />{radio.who}</span>
          <span className="said">{radio.text}</span>
        </div>
      )}

      <div className="power" ref={el => { hud.current.power = el }} aria-hidden="true">
        <div className="orb">
          <div className="pie" ref={el => { hud.current.pie = el }} />
          <div className="spokes" />
          <div className="shine" />
        </div>
        <span className="label">power</span>
        <div className="chips">
          <span className="chip aqua hidden" ref={el => { hud.current.triple = el }} />
          <span className="chip yellow hidden" ref={el => { hud.current.ducks = el }} />
          <span className="chip blue hidden" ref={el => { hud.current.shield = el }} />
        </div>
      </div>

      {showHints && (
        <div className="hint glass">
          <span><kbd>←→</kbd> turn <kbd>↑↓</kbd> pitch</span>
          <span><kbd>space</kbd> boost <kbd>shift</kbd> brake</span>
          <span><kbd>F</kbd> / click fire <em>(auto when lined up)</em></span>
          <span><kbd>←←</kbd> barrel roll: bats away shots</span>
          <span><kbd>V</kbd> {VIEW_NAMES[state.mode]} <kbd>M</kbd> sound {state.sound ? 'on' : 'off'} <kbd>esc</kbd> pause</span>
        </div>
      )}
      {isTouch && !state.paused && (
        <>
          {!state.title && (phase === 'idle' || phase === 'calm') && <div className="touch-hint glass">drag to steer · guns fire on their own</div>}
          <div className="touch right">
            <button className="gel big boost" {...hold(1)}>boost</button>
            <button className="gel brake" {...hold(-1)}>brake</button>
            <button className="gel roll" onPointerDown={roll}>roll</button>
          </div>
          <div className="touch top">
            <button className="gel" onClick={() => eng()?.cycleView()}>view</button>
            <button className="gel" onClick={() => eng()?.toggleSound()}>{state.sound ? 'mute' : 'sound'}</button>
          </div>
        </>
      )}

      <div className="speedo glass" ref={el => { hud.current.root = el }} aria-hidden="true">
        <svg className="gauge" viewBox="0 0 60 60">
          <defs>
            <radialGradient id="face" cx="40%" cy="30%" r="75%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.6" stopColor="#dff6ff" />
              <stop offset="1" stopColor="#9fd8f4" />
            </radialGradient>
          </defs>
          <circle className="rim" cx="30" cy="30" r="28.5" />
          <circle className="face" cx="30" cy="30" r="26" fill="url(#face)" />
          <path className="arc" d={`M ${polar(-135, 22).join(' ')} A 22 22 0 1 1 ${polar(135, 22).join(' ')}`} />
          {TICKS.map(a => {
            const [x1, y1] = polar(a, 17.5), [x2, y2] = polar(a, 22)
            return <line key={a} className={a > 90 ? 'tick red' : 'tick'} x1={x1} y1={y1} x2={x2} y2={y2} />
          })}
          <line className="needle" x1="30" y1="33" x2="30" y2="10" ref={el => { hud.current.needle = el }} transform="rotate(-135 30 30)" />
          <circle className="hub" cx="30" cy="30" r="3" />
          <path className="gloss" d="M 9 25 A 21 21 0 0 1 51 25 Q 30 31 9 25 Z" />
        </svg>
        <div className="readout">
          <div className="speed"><b ref={el => { hud.current.num = el }}>139</b> <span ref={el => { hud.current.unit = el }}>mph</span></div>
          <small ref={el => { hud.current.status = el }} />
        </div>
      </div>

      {state.title && !state.paused && (
        <div className="title" aria-hidden="true">
          <div className="logo">
            <span className="name">kai howard</span>
            <span className="sixtyfour">64</span>
          </div>
          <div className="subtitle">vs. the Newtonian Air Force</div>
          <div className="press gel">{isTouch ? 'touch to fly' : 'press any key to fly'}</div>
          {stats.best > 0 && <div className="title-best">best {stats.best.toLocaleString()}</div>}
        </div>
      )}
      <div key={state.mode} className="flash">{VIEW_NAMES[state.mode]}</div>
      {tier && <div key={tier.id} className="tier">{tier.name}</div>}
      {banner && (
        <div key={banner.id} className="banner">
          <b>{banner.title}</b>
          {banner.sub && <span>{banner.sub}</span>}
        </div>
      )}
      {pops.map(p => (
        <span key={p.id} className={'pop ' + p.kind} style={{ left: p.x, top: p.y, '--tilt': `${p.tilt}deg` }}>{p.text}</span>
      ))}

      {state.paused && (
        <div className="pause-wrap" onClick={() => eng()?.togglePause(false)}>
          <div className="pause window" onClick={e => e.stopPropagation()}>
            <div className="titlebar">
              <span>kaihoward.com · paused</span>
              <button className="close" onClick={() => eng()?.togglePause(false)} aria-label="Resume">×</button>
            </div>
            <div className="body">
              <h1>Kai Howard</h1>
              <a className="mail" href="mailto:kaihoward106@gmail.com">kaihoward106@gmail.com</a>
              <nav>
                {projects.map(p => (
                  <a key={p.href} href={p.href} target="_blank" rel="noreferrer">
                    <span>{p.name}</span><small>{p.domain}</small>
                  </a>
                ))}
              </nav>
              <div className="stats">
                <span><b>{stats.score.toLocaleString()}</b> score</span>
                <span><b>{stats.kills}</b> jets</span>
                <span><b>{stats.wave}</b> wave</span>
                <span><b>{stats.best.toLocaleString()}</b> best</span>
              </div>
              <div className="keys">
                <span><kbd>←→↑↓</kbd> fly</span><span><kbd>space</kbd> boost</span><span><kbd>shift</kbd> brake / reverse</span>
                <span><kbd>F</kbd> fire</span><span><kbd>←←</kbd> barrel roll</span><span><kbd>Q E</kbd> roll</span>
                <span><kbd>V</kbd> view</span><span><kbd>M</kbd> sound</span><span><kbd>R</kbd> respawn</span>
              </div>
              <button className="resume gel" onClick={() => eng()?.togglePause(false)}>resume</button>
            </div>
          </div>
        </div>
      )}

      <div ref={fadeRef} className="fade" />
    </div>
  )
}
