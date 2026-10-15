import * as THREE from 'three'

// The combat overlay, drawn flat on top of the 3D: brackets round the jets, arrows to the ones
// you can't see, the gunsight, missile warnings, and a glassy radar in the corner.

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3()
const TAU = Math.PI * 2

export class Hud2D {
  constructor(canvas) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')
    this.w = 1; this.h = 1; this.dpr = 1
    this.sweep = 0
  }

  resize(w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.w = w; this.h = h; this.dpr = dpr
    this.canvas.width = Math.round(w * dpr)
    this.canvas.height = Math.round(h * dpr)
  }

  // world point -> screen; z > 1 means behind the camera
  project(p, camera, out) {
    _v.copy(p).project(camera)
    out.x = (_v.x + 1) / 2 * this.w
    out.y = (1 - _v.y) / 2 * this.h
    out.z = _v.z
    out.behind = _v.z > 1
    out.on = !out.behind && out.x > 0 && out.x < this.w && out.y > 0 && out.y < this.h
    return out
  }

  // a point on the screen edge in the direction of p
  edge(p, camera, out) {
    _v.copy(p).applyMatrix4(camera.matrixWorldInverse)
    let x = _v.x, y = _v.y
    if (_v.z > 0) { x = -x; y = -y } // behind: flip so the arrow still points the right way round
    if (Math.abs(x) < 1e-6 && Math.abs(y) < 1e-6) y = -1
    const a = Math.atan2(-y, x)
    const mx = this.w / 2 - 46, my = this.h / 2 - 56
    const k = Math.min(mx / Math.abs(Math.cos(a) || 1e-6), my / Math.abs(Math.sin(a) || 1e-6))
    out.x = this.w / 2 + Math.cos(a) * k
    out.y = this.h / 2 + Math.sin(a) * k
    out.a = a
    return out
  }

  draw(camera, fl, combat, t, show = true) {
    const c = this.ctx, w = this.w, h = this.h
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
    c.clearRect(0, 0, w, h)
    if (!show) return
    c.lineJoin = 'round'
    c.lineCap = 'round'

    // hurt / missile vignette
    if (combat.hurt > 0.01) {
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7)
      g.addColorStop(0, 'rgba(255,40,60,0)')
      g.addColorStop(1, `rgba(255,40,60,${(combat.hurt * 0.55).toFixed(3)})`)
      c.fillStyle = g
      c.fillRect(0, 0, w, h)
    }
    if (combat.warn === 'missile') {
      const k = 0.5 + 0.5 * Math.sin(t * 18)
      c.strokeStyle = `rgba(255,60,80,${(0.25 + k * 0.45).toFixed(3)})`
      c.lineWidth = 10
      c.strokeRect(5, 5, w - 10, h - 10)
    }

    const p = {}, e = {}
    // gunsight, out ahead of the nose
    if (!combat.ko && combat.phase !== 'idle') {
      fl.forward(_f)
      this.project(_v.copy(fl.pos).addScaledVector(_f, 260), camera, p)
      if (!p.behind) {
        const locked = !!combat.lock && combat.lock.ang < 0.1
        this.sight(p.x, p.y, locked, combat.firing, t)
      }
    }

    // jets
    for (const j of combat.jets) {
      if (!j.alive) continue
      const d = j.pos.distanceTo(fl.pos)
      this.project(j.pos, camera, p)
      const locked = combat.lock && combat.lock.jet === j
      const col = j.spec.boss ? '#ff4fd8' : '#ff4a5e'
      if (p.on) {
        const s = Math.max(13, Math.min(60, 2600 / Math.max(1, d) * (j.spec.boss ? 4 : 1)))
        this.bracket(p.x, p.y, s, locked ? '#ffe14a' : col, locked)
        // health, as a glossy little bar
        const hp = Math.max(0, j.hp / j.spec.hp)
        this.bar(p.x - s, p.y + s + 6, s * 2, 5, hp, col)
        c.font = '700 11px "Segoe UI", "Source Sans 3", sans-serif'
        c.textAlign = 'center'
        this.label(j.callsign.toLowerCase() + (d > 300 ? `  ${Math.round(d)}m` : ''), p.x, p.y - s - 7, '#ffffff')
      } else {
        this.edge(j.pos, camera, e)
        this.arrow(e.x, e.y, e.a, j.spec.boss ? 15 : 11, col, Math.round(d) + 'm')
      }
    }

    // their missiles, if they're after you
    for (const m of combat.missiles) {
      if (m.mine || m.lost) continue
      const d = m.p.distanceTo(fl.pos)
      if (d > 3000) continue
      const blink = Math.sin(t * 20) > -0.2
      this.project(m.p, camera, p)
      if (p.on) {
        if (blink) this.diamond(p.x, p.y, 9, '#ff3b3b')
      } else {
        this.edge(m.p, camera, e)
        if (blink) this.arrow(e.x, e.y, e.a, 13, '#ff3b3b', 'missile')
      }
    }

    // power-ups you can see
    for (const pk of combat.pickups) {
      const d = pk.p.distanceTo(fl.pos)
      if (d < 40 || d > 1600) continue
      this.project(pk.group.position, camera, p)
      if (!p.on) continue
      c.strokeStyle = 'rgba(160,240,255,0.9)'
      c.lineWidth = 2
      c.beginPath(); c.arc(p.x, p.y, 10 + Math.sin(t * 4) * 2, 0, TAU); c.stroke()
    }

    // boss health across the top
    const boss = combat.jets.find(j => j.alive && j.spec.boss)
    if (boss) {
      const bw = Math.min(420, w * 0.6), bx = (w - bw) / 2, by = 92
      c.font = '700 13px "Segoe UI", "Source Sans 3", sans-serif'
      c.textAlign = 'center'
      this.label(boss.callsign, w / 2, by - 6, '#ffffff')
      this.bar(bx, by, bw, 12, boss.hp / boss.spec.hp, '#ff4fd8')
    }

    this.radar(fl, combat, t)
  }

  sight(x, y, locked, firing, t) {
    const c = this.ctx
    const col = locked ? '#ffe14a' : 'rgba(210,250,255,0.95)'
    const r = locked ? 13 + Math.sin(t * 16) * 1.5 : 15
    c.lineWidth = 4; c.strokeStyle = 'rgba(0,40,80,0.45)'
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke()
    c.lineWidth = 2; c.strokeStyle = col
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.stroke()
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      c.beginPath(); c.moveTo(x + dx * (r + 3), y + dy * (r + 3)); c.lineTo(x + dx * (r + 9), y + dy * (r + 9)); c.stroke()
    }
    c.fillStyle = col
    c.beginPath(); c.arc(x, y, firing ? 3 : 2, 0, TAU); c.fill()
  }

  bracket(x, y, s, col, locked) {
    const c = this.ctx, k = s * 0.45
    const path = () => {
      c.beginPath()
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        c.moveTo(x + sx * s, y + sy * (s - k)); c.lineTo(x + sx * s, y + sy * s); c.lineTo(x + sx * (s - k), y + sy * s)
      }
    }
    c.lineWidth = 5; c.strokeStyle = 'rgba(40,0,10,0.4)'; path(); c.stroke()
    c.lineWidth = 2.2; c.strokeStyle = col; path(); c.stroke()
    if (locked) { c.lineWidth = 1.5; this.diamondPath(x, y, s * 0.55); c.stroke() }
  }

  diamondPath(x, y, s) {
    const c = this.ctx
    c.beginPath(); c.moveTo(x, y - s); c.lineTo(x + s, y); c.lineTo(x, y + s); c.lineTo(x - s, y); c.closePath()
  }
  diamond(x, y, s, col) {
    const c = this.ctx
    c.lineWidth = 2.5; c.strokeStyle = col
    this.diamondPath(x, y, s); c.stroke()
  }

  arrow(x, y, a, s, col, text) {
    const c = this.ctx
    c.save()
    c.translate(x, y)
    c.rotate(a)
    c.beginPath(); c.moveTo(s, 0); c.lineTo(-s * 0.7, -s * 0.75); c.lineTo(-s * 0.3, 0); c.lineTo(-s * 0.7, s * 0.75); c.closePath()
    c.fillStyle = col; c.fill()
    c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke()
    c.restore()
    if (text) {
      c.font = '700 11px "Segoe UI", "Source Sans 3", sans-serif'
      c.textAlign = 'center'
      this.label(text, x - Math.cos(a) * (s + 16), y - Math.sin(a) * (s + 10) + 4, '#ffffff')
    }
  }

  label(text, x, y, col) {
    const c = this.ctx
    c.lineWidth = 3; c.strokeStyle = 'rgba(0,30,60,0.6)'
    c.strokeText(text, x, y)
    c.fillStyle = col
    c.fillText(text, x, y)
  }

  bar(x, y, w, h, k, col) {
    const c = this.ctx
    this.round(x, y, w, h, h / 2)
    c.fillStyle = 'rgba(0,30,60,0.45)'; c.fill()
    if (k > 0) {
      this.round(x, y, Math.max(h, w * k), h, h / 2)
      c.fillStyle = col; c.fill()
      // the gloss
      this.round(x + 1, y + 1, Math.max(h, w * k) - 2, h * 0.45, h * 0.25)
      c.fillStyle = 'rgba(255,255,255,0.45)'; c.fill()
    }
    this.round(x, y, w, h, h / 2)
    c.lineWidth = 1; c.strokeStyle = 'rgba(255,255,255,0.8)'; c.stroke()
  }

  round(x, y, w, h, r) {
    const c = this.ctx
    c.beginPath()
    c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r)
    c.closePath()
  }

  // a glass radar: heading up, three kilometres to the rim
  radar(fl, combat, t) {
    const c = this.ctx, w = this.w, h = this.h
    const small = w < 700
    const R = small ? 46 : 62
    const cx = w - R - (small ? 14 : 24), cy = small ? R + 84 : h - R - 26
    const range = 3000
    // glass disc
    const g = c.createRadialGradient(cx - R * 0.3, cy - R * 0.4, R * 0.1, cx, cy, R)
    g.addColorStop(0, 'rgba(200,250,255,0.55)')
    g.addColorStop(0.6, 'rgba(60,170,230,0.45)')
    g.addColorStop(1, 'rgba(10,80,160,0.6)')
    c.fillStyle = g
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill()
    c.strokeStyle = 'rgba(255,255,255,0.35)'; c.lineWidth = 1
    for (const k of [0.33, 0.66]) { c.beginPath(); c.arc(cx, cy, R * k, 0, TAU); c.stroke() }
    c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke()
    // sweep
    this.sweep = (t * 1.6) % TAU
    const sg = c.createConicGradient ? c.createConicGradient(this.sweep - 0.9, cx, cy) : null
    if (sg) {
      sg.addColorStop(0, 'rgba(160,255,200,0)')
      sg.addColorStop(0.14, 'rgba(160,255,200,0.35)')
      sg.addColorStop(0.145, 'rgba(160,255,200,0)')
      c.fillStyle = sg
      c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fill()
    }
    // heading-up frame
    fl.forward(_f); _f.y = 0
    if (_f.lengthSq() < 1e-6) _f.set(0, 0, -1)
    _f.normalize()
    _r.set(-_f.z, 0, _f.x)
    const put = (pos, fn) => {
      const dx = pos.x - fl.pos.x, dz = pos.z - fl.pos.z
      let x = (dx * _r.x + dz * _r.z) / range * R, y = -(dx * _f.x + dz * _f.z) / range * R
      const l = Math.hypot(x, y)
      if (l > R - 4) { x *= (R - 4) / l; y *= (R - 4) / l }
      fn(cx + x, cy + y, pos.y - fl.pos.y)
    }
    for (const pk of combat.pickups) put(pk.p, (x, y) => { c.fillStyle = '#9ff4ff'; c.beginPath(); c.arc(x, y, 2.5, 0, TAU); c.fill() })
    for (const m of combat.missiles) {
      if (m.mine) continue
      if (Math.sin(t * 20) > 0) put(m.p, (x, y) => { c.fillStyle = '#ffffff'; c.fillRect(x - 1.5, y - 1.5, 3, 3) })
    }
    for (const j of combat.jets) {
      if (!j.alive) continue
      put(j.pos, (x, y, dy) => {
        const s = j.spec.boss ? 5 : 3.5
        c.fillStyle = j.spec.boss ? '#ff4fd8' : '#ff3b4e'
        c.beginPath(); c.arc(x, y, s, 0, TAU); c.fill()
        c.strokeStyle = 'rgba(255,255,255,0.9)'; c.lineWidth = 1; c.stroke()
        if (Math.abs(dy) > 150) { c.fillStyle = '#ffffff'; c.beginPath(); const k = dy > 0 ? -1 : 1; c.moveTo(x + 5, y + k * 2); c.lineTo(x + 9, y + k * 2); c.lineTo(x + 7, y - k * 2); c.fill() }
      })
    }
    // you
    c.fillStyle = '#ffffff'
    c.beginPath(); c.moveTo(cx, cy - 5); c.lineTo(cx + 4, cy + 4); c.lineTo(cx, cy + 2); c.lineTo(cx - 4, cy + 4); c.closePath(); c.fill()
    // gloss and rim
    c.fillStyle = 'rgba(255,255,255,0.28)'
    c.beginPath(); c.ellipse(cx, cy - R * 0.45, R * 0.72, R * 0.42, 0, Math.PI, TAU); c.fill()
    c.lineWidth = 2.5; c.strokeStyle = 'rgba(255,255,255,0.9)'
    c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.stroke()
    c.lineWidth = 1; c.strokeStyle = 'rgba(0,60,120,0.6)'
    c.beginPath(); c.arc(cx, cy, R + 1.5, 0, TAU); c.stroke()
  }
}
