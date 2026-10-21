// The undertaker: a Quixote-thin stick figure in a top hat, scythe over his shoulder. He walks back
// and forth across the whole header on one flat plane, level with the tops of the short letters,
// and the big "scythe" letters stand on it. Over the word the ground is the top edge traced from the
// glyphs themselves (the curve of the 's', the slope of the 't', the 'h' stem and its shoulder) and
// every step lands on it: a foot is planted where it touches down and stays put while his body
// passes over it, then lifts and swings to the next spot. The legs are solved from hip to planted
// foot, so the knees bend to whatever is underfoot. Every so often he walks to a letter, gathers his
// feet, bends his knees and sits on its top edge, legs swinging round toward you and hanging over
// the letter's face, the scythe upright beside him like a staff. Then he stands and strolls on.
// Nothing snaps. Reach for him and he springs up and runs: leaning in, knees driving, heels kicking
// up, both feet off the ground between strides. With reduced motion he just sits on the 'h'.
//
// He makes an entrance: upside down, he peeks in at you from the top of the frame, hands on its edge,
// looks one way and the other, and pulls back out of sight. A beat later he drops in, arms up, coat
// tails flying, his hat floating a little above his head, lands on the letters with his knees giving,
// the hat drops back on, and he strolls off.
//
// One file for the landing page (scythe-landing/site) and the web app's signed-out page (scythe/frontend):
// keep the two copies identical. mountUndertaker({ svg, banner, wordmark }) starts him and returns stop().

export function mountUndertaker({ svg: svgEl, banner, wordmark }) {
  if (!svgEl || !banner || !wordmark) return () => {}
  const NS = 'http://www.w3.org/2000/svg'
  let stopped = false

  // ---------------------------------------------------------------- body plan (local units, facing right)
  const THIGH = 27, SHIN = 28, TORSO = 36, NECK = 5, HEAD = 6.5
  const UPPER = 20, FORE = 19
  const SCALE = 1.5
  const REACH = (THIGH + SHIN) * SCALE // a straight leg, in page pixels

  let width = banner.clientWidth, HEIGHT = banner.clientHeight || 800
  const part = (parent, tag, cls) => {
    const e = document.createElementNS(NS, tag)
    if (cls) e.setAttribute('class', cls)
    parent.appendChild(e)
    return e
  }
  const fig = part(svgEl, 'g', 'figure')
  const coat = part(fig, 'path', 'stroke thin')
  const body = part(fig, 'path', 'stroke')
  const headEl = part(fig, 'circle', 'stroke')
  headEl.setAttribute('r', HEAD)
  const hat = part(fig, 'path', 'solid')
  const snath = part(fig, 'path', 'stroke')
  const blade = part(fig, 'path', 'solid')

  // ---------------------------------------------------------------- geometry helpers
  const at = (p, a, l) => [p[0] + Math.sin(a) * l, p[1] + Math.cos(a) * l] // angle from straight down
  const up = (p, a, l) => [p[0] + Math.sin(a) * l, p[1] - Math.cos(a) * l] // angle from straight up
  const ln = (...pts) => 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join('L')
  const mx = (a, b, t) => a + (b - a) * t
  const lerpP = (a, b, t) => [mx(a[0], b[0], t), mx(a[1], b[1], t)]
  const smooth = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v))

  // ---------------------------------------------------------------- the ground: one flat plane, and the letters on it
  // The ground runs the full width of the header at the height of the short letters' tops. Over the
  // word it is the top edge of the ink: each letter is drawn on a canvas at its place on the page, in
  // the wordmark's font, and every pixel column is scanned for its first inked pixel. Notches narrower
  // than a foot (between the arms of the 'y', the gaps between letters, the rounded outer edges of
  // the 's' and 'e' where they meet the plane) are bridged, so he steps over them, not into them.
  let letters = [] // {ch, cx, left, right} in banner coordinates
  let span = [0, 0], prof = null // prof[x]: the ground's height at banner column x
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d', { willReadFrequently: true })

  function measureGround() {
    const tn = wordmark.firstChild
    if (!tn || tn.nodeType !== Node.TEXT_NODE) return
    const bR = banner.getBoundingClientRect()
    const probe = document.createElement('span') // sits on the baseline
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    wordmark.appendChild(probe)
    const baseline = probe.getBoundingClientRect().top - bR.top
    probe.remove()
    const cs = getComputedStyle(wordmark), size = parseFloat(cs.fontSize)
    const range = document.createRange()
    letters = []
    for (let i = 0; i < tn.length; i++) {
      range.setStart(tn, i); range.setEnd(tn, i + 1)
      const r = range.getBoundingClientRect()
      if (r.width < 2) continue
      letters.push({ ch: tn.textContent[i], cx: r.left - bR.left + r.width / 2, left: r.left - bR.left, right: r.right - bR.left })
    }
    if (!letters.length) return
    span = [letters[0].left, letters[letters.length - 1].right]

    const cx0 = Math.floor(span[0]) - 2
    const W = Math.ceil(span[1]) - cx0 + 4, top0 = Math.floor(baseline - size * 1.1), H = Math.ceil(baseline - top0) + 2
    canvas.width = W; canvas.height = H
    ctx.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    ctx.textBaseline = 'alphabetic'
    for (const l of letters) ctx.fillText(l.ch, l.left - cx0, baseline - top0)
    const ink = ctx.getImageData(0, 0, W, H).data
    const N = Math.ceil(width) + 1
    const raw = new Array(N).fill(Infinity)
    let first = Infinity, lastInk = -Infinity
    for (let c = 0; c < W; c++) {
      const i = cx0 + c
      if (i < 0 || i >= N) continue
      for (let j = 0; j < H; j++) {
        if (ink[(j * W + c) * 4 + 3] > 110) { raw[i] = top0 + j; first = Math.min(first, i); lastInk = Math.max(lastInk, i); break }
      }
    }
    // The plane: the most common top edge, which is the top of the short letters.
    const tops = raw.filter(Number.isFinite).sort((a, b) => a - b)
    const level = tops.length ? tops[Math.floor(tops.length / 2)] : baseline - size * 0.5
    for (let i = 0; i < N; i++) if (i < first || i > lastInk) raw[i] = level
    const w = Math.round(size * 0.22)
    prof = raw.map((v, i) => {
      let l = Infinity, r = Infinity
      for (let k = Math.max(0, i - w); k <= i; k++) l = Math.min(l, raw[k])
      for (let k = i; k <= Math.min(N - 1, i + w); k++) r = Math.min(r, raw[k])
      return Math.min(v, Math.max(l, r))
    })
    // Wider gaps inside the word: a straight line between the edges on either side.
    for (let i = 0; i < N;) {
      if (isFinite(prof[i])) { i++; continue }
      let j = i
      while (j < N && !isFinite(prof[j])) j++
      const a = i > 0 ? prof[i - 1] : level, b = j < N ? prof[j] : a
      for (let k = i; k < j; k++) prof[k] = mx(a, b, (k - i + 1) / (j - i + 1))
      i = j
    }
  }
  function ground(px) { // off either edge of the header the plane carries on, level
    if (!prof) return HEIGHT * 0.4
    const f = Math.min(prof.length - 1, Math.max(0, px)), i = Math.floor(f)
    return mx(prof[i], prof[Math.min(prof.length - 1, i + 1)], f - i)
  }

  // ---------------------------------------------------------------- state
  let x, dir = 1, speed = 0, fleeUntil = 0
  let runBlend = 0   // 0 walking … 1 running
  let sitBlend = 0   // 0 standing … 1 seated
  let target = null  // the letter he is walking to, or sitting on
  const feet = [{ x: 0, y: 0 }, { x: 0, y: 0 }] // page positions; planted unless that foot is swinging
  const swings = [null, null] // per foot, while it is in the air: {from: [x, y], to: x, t, dur}
  let phase = 0, hipY = 0 // phase drives the arms and coat: π per step
  let sit0 = null    // where he stood when he began to sit: {hipY, feet}
  const S = { STROLL: 0, APPROACH: 1, SITTING: 2, SEATED: 3, RISING: 4, RUN: 5, PEEK: 6, HIDDEN: 7, DROP: 8, LAND: 9 }
  let state = S.PEEK, timer = 3 + Math.random() * 3

  // step: how far apart the feet land. height: the hip, as a share of a straight leg.
  const WALK = { speed: 34, step: 30, height: 0.95, lean: 0.06, arm: 0.35 }
  const RUN = { speed: 230, step: 80, height: 0.86, lean: 0.42, arm: 1.0 }

  const standingHip = () => (feet[0].y + feet[1].y) / 2 - REACH * WALK.height
  function plantFeet() {
    feet[0].x = x - 4 * dir; feet[1].x = x + 4 * dir
    for (const f of feet) f.y = ground(f.x)
    swings[0] = swings[1] = null
    hipY = standingHip()
    if (sitBlend > 0) sit0 = { hipY, feet: feet.map((f) => ({ ...f })) }
  }

  function layout() {
    if (stopped) return
    width = banner.clientWidth; HEIGHT = banner.clientHeight || 800
    svgEl.setAttribute('width', width); svgEl.setAttribute('height', HEIGHT)
    measureGround()
    if (!letters.length) return
    if (x === undefined) x = letters[Math.min(2, letters.length - 1)].cx // he peeks in over the 'y'
    if (target) target = letters.reduce((a, l) => (Math.abs(l.cx - x) < Math.abs(a.cx - x) ? l : a), letters[0])
    if (target && sitBlend > 0) x = target.cx
    if (state < S.PEEK) plantFeet() // during the entrance his feet are in the air
  }
  const resized = new ResizeObserver(layout)
  resized.observe(banner)
  if (document.fonts) document.fonts.ready.then(layout) // the web font changes every glyph's shape
  layout()
  if (x === undefined) { resized.disconnect(); svgEl.replaceChildren(); return () => {} }

  // ---------------------------------------------------------------- a leg: hip to foot, knee forward
  // f is a foot on the page; the result is in the figure's local units with the hip at the origin.
  function leg(f, hy) {
    const F = [(f.x - x) * dir / SCALE, (f.y - hy) / SCALE]
    const a = Math.atan2(F[1], F[0])
    const d = Math.min(THIGH + SHIN - 0.01, Math.max(Math.abs(THIGH - SHIN) + 0.01, Math.hypot(F[0], F[1])))
    const bend = Math.acos((THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d))
    const knee = [Math.cos(a - bend) * THIGH, Math.sin(a - bend) * THIGH]
    const k = Math.atan2(F[1] - knee[1], F[0] - knee[0])
    const foot = [knee[0] + Math.cos(k) * SHIN, knee[1] + Math.sin(k) * SHIN]
    // The toe lies along the slope underfoot.
    const s = Math.atan2(ground(f.x + dir * 3) - ground(f.x - dir * 3), 6)
    return { knee, foot, toe: [foot[0] + Math.cos(s) * 5, foot[1] + Math.sin(s) * 5] }
  }

  // ---------------------------------------------------------------- blade and hat
  function crescent(top, tilt) {
    const ux = Math.sin(tilt), uy = -Math.cos(tilt), px = -uy, py = ux, L = 46
    const tip = [top[0] + px * L - ux * 6, top[1] + py * L - uy * 6]
    const outer = [top[0] + px * L * 0.55 + ux * 16, top[1] + py * L * 0.55 + uy * 16]
    const inner = [top[0] + px * L * 0.5 + ux * 5, top[1] + py * L * 0.5 + uy * 5]
    return `M${top}Q${outer} ${tip}Q${inner} ${top}Z`
  }
  // lift: how far the hat floats above his head (falling, it lags behind him).
  function topHat(hd, tilt, t, lift = 0) {
    const ht = tilt - 0.18 * t, cb = up(hd, ht, HEAD - 1 + lift)
    const ax = Math.cos(ht), ay = Math.sin(ht), sd = (p, s) => [p[0] + ax * s, p[1] + ay * s]
    const ct = up(cb, ht, 15)
    return ln(sd(cb, -9), sd(cb, 9), sd(cb, 5), sd(ct, 5), sd(ct, -5), sd(cb, -5)) + 'Z'
  }

  // ---------------------------------------------------------------- walking / running
  // t: 0 walking … 1 running. m: how much of the swagger is left (0 when he stands still).
  // o.raise: 0 … 1, arms flung up and coat tails flying (falling). o.hatLift: the hat floating off his head.
  function walkPose(t, m, o = {}) {
    const raise = o.raise || 0
    const g = (k) => mx(WALK[k], RUN[k], t)
    const lean = g('lean') * m
    const hip = [0, 0]
    const legs = [leg(feet[0], hipY), leg(feet[1], hipY)]
    const shoulder = up(hip, lean, TORSO), neck = up(shoulder, lean, NECK), hd = up(neck, lean, HEAD)
    const swingA = g('arm') * m * Math.sin(phase + Math.PI)
    const bElbow = at(shoulder, mx(swingA - 0.1, Math.PI - 0.7, raise), UPPER)
    const bHand = at(bElbow, mx(swingA + mx(0.3, 1.4, t), Math.PI - 0.25, raise), FORE)
    const fElbow = at(shoulder, mx(mx(0.75, 1.15, t) + 0.08 * m * Math.sin(phase * 2), Math.PI - 1.1, raise), UPPER)
    const hand = at(fElbow, mx(mx(1.9, 2.5, t), Math.PI - 0.6, raise), FORE)
    const tilt = mx(mx(-0.38, -1.25, t) + 0.05 * m * Math.sin(phase * 2), 0.35, raise)
    const top = up(hand, tilt, mx(78, 70, t)), butt = up(hand, tilt + Math.PI, 20)
    const flap = Math.sin(phase * 2) * mx(0.08, 0.25, t) * m + raise * 0.18 * Math.sin(phase * 5)
    const tailA = at(hip, mx(-mx(0.35, 1.05, t) * (0.3 + 0.7 * m), -2.55, raise) - flap, 30)
    const tailB = at(hip, mx(-mx(0.2, 0.85, t) * (0.3 + 0.7 * m), -2.2, raise) + flap, 26)
    return {
      body: ln(legs[0].toe, legs[0].foot, legs[0].knee, hip, legs[1].knee, legs[1].foot, legs[1].toe) +
        ln(hip, shoulder, neck) + ln(bHand, bElbow, shoulder, fElbow, hand),
      coat: ln(tailA, hip, tailB), hd, hatD: topHat(hd, lean, t, o.hatLift || 0), snath: ln(butt, top), blade: crescent(top, tilt),
      hipW: hipY,
    }
  }

  // ---------------------------------------------------------------- sitting down (s: 0 standing … 1 seated)
  // First half: feet stay planted where he stopped and the hip sinks into a crouch, the knees
  // solved to the feet. Second half: the hip comes down onto the letter's top edge while the legs
  // swing round toward you and hang over the letter's face, a little apart.
  const SEATED_LEGS = [{ knee: [7, 6], foot: [8, 6 + SHIN], toe: [12, 5 + SHIN] }, { knee: [-3, 7], foot: [-3, 7 + SHIN], toe: [1, 6 + SHIN] }]
  const KEY = {
    stand:  { lean: 0,    handA: 0.75, handB: 1.9, tilt: -0.38, tail: 0 },
    crouch: { lean: 0.38, handA: 0.95, handB: 1.7, tilt: -0.2,  tail: 0.5 },
    seated: { lean: 0.02, handA: 0.6,  handB: 2.2, tilt: 0.12,  tail: 1 },
  }
  function sitPose(s) {
    const e = smooth(s)
    const [from, to, t] = e < 0.5 ? ['stand', 'crouch', e * 2] : ['crouch', 'seated', (e - 0.5) * 2]
    const k = {}
    for (const key of Object.keys(KEY[from])) k[key] = mx(KEY[from][key], KEY[to][key], t)
    const planted = sit0.feet
    const crouchY = (planted[0].y + planted[1].y) / 2 - 26 * SCALE
    const seatY = ground(x) + 2 * SCALE // the coat settles onto the edge
    const hipW = e < 0.5 ? mx(sit0.hipY, crouchY, t) : mx(crouchY, seatY, t)
    const onFeet = [leg(planted[0], hipW), leg(planted[1], hipW)]
    const legs = e < 0.5 ? onFeet : onFeet.map((l, i) => {
      const b = SEATED_LEGS[i], u = smooth(t)
      return { knee: lerpP(l.knee, b.knee, u), foot: lerpP(l.foot, b.foot, u), toe: lerpP(l.toe, b.toe, u) }
    })
    const hip = [0, 0]
    const shoulder = up(hip, k.lean, TORSO), neck = up(shoulder, k.lean, NECK), hd = up(neck, k.lean, HEAD)
    // Back hand comes to rest on the near knee; the front hand keeps the scythe.
    const bElbow = at(shoulder, mx(-0.1, 0.6, e), UPPER), bHand = lerpP(at(bElbow, 0.3, FORE), legs[0].knee, e)
    const fElbow = at(shoulder, k.handA, UPPER), hand = at(fElbow, k.handB, FORE)
    // The snath swings from over the shoulder to upright, held like a staff while he sits.
    const top = up(hand, k.tilt, 78), butt = up(hand, k.tilt + Math.PI, 20)
    // Coat tails fall behind him, over the back of the letter.
    const tailA = at(hip, mx(-0.105, -0.5, k.tail), 30), tailB = at(hip, mx(-0.06, -0.3, k.tail), 26)
    return {
      body: ln(legs[0].toe, legs[0].foot, legs[0].knee, hip, legs[1].knee, legs[1].foot, legs[1].toe) +
        ln(hip, shoulder, neck) + ln(bHand, bElbow, shoulder, fElbow, hand),
      coat: ln(tailA, hip, tailB), hd, hatD: topHat(hd, k.lean, 0), snath: ln(butt, top), blade: crescent(top, k.tilt),
      hipW,
    }
  }

  // ---------------------------------------------------------------- peeking in (upside down, from the top of the frame)
  // Drawn upright in his own units and flipped: his head and hat hang down into the frame, his arms
  // reach back up to its top edge, everything below the waist (and the scythe) stays up out of sight.
  // look: -1 … 1, which way he's looking. hy: the hip's page height, above the top of the frame.
  function peekPose(look, hy) {
    const lean = 0.22 * look
    const hip = [0, 0]
    const shoulder = up(hip, lean * 0.4, TORSO), neck = up(shoulder, lean, NECK), hd = up(neck, lean, HEAD)
    // Hands on the edge: in the flipped picture "down" is up, so the arms hang toward the frame's top.
    const edge = (hy - 0) / SCALE // the frame's top, from the hip, in his units (flipped: positive is up the page)
    const bElbow = at(shoulder, -0.55, UPPER), fElbow = at(shoulder, 0.55, UPPER)
    const reach = (el, side) => [el[0] + side * 4, Math.min(el[1] + FORE, edge > 0 ? edge : el[1] + FORE)]
    return {
      body: ln(reach(bElbow, -1), bElbow, shoulder, fElbow, reach(fElbow, 1)) + ln(hip, shoulder, neck),
      coat: '', hd, hatD: topHat(hd, lean, 0), snath: '', blade: '', hipW: hy, flip: true,
    }
  }

  function draw(p = sitBlend > 0 ? sitPose(sitBlend) : walkPose(runBlend, Math.min(1, speed / WALK.speed))) {
    fig.setAttribute('transform', `translate(${x.toFixed(1)},${p.hipW.toFixed(1)}) scale(${dir * SCALE},${(p.flip ? -1 : 1) * SCALE})`)
    body.setAttribute('d', p.body); coat.setAttribute('d', p.coat)
    headEl.setAttribute('cx', p.hd[0]); headEl.setAttribute('cy', p.hd[1])
    hat.setAttribute('d', p.hatD); snath.setAttribute('d', p.snath); blade.setAttribute('d', p.blade)
  }

  // ---------------------------------------------------------------- stepping
  // Walking, one foot is always down: a foot leaves only once the other has landed. Running, the
  // trailing foot pushes off before the leading one lands, so for a moment both are in the air;
  // it also lets go early rather than stretch the leg straight behind him, and it lands just ahead
  // of where his hip will be by then. The hip holds a running crouch instead of being hauled about
  // by whichever foot is planted.
  function stepFeet(dt) {
    const run = runBlend, stepLen = mx(WALK.step, RUN.step, run), moving = speed > 3
    const order = [0, 1].sort((a, b) => (x - feet[b].x) * dir - (x - feet[a].x) * dir) // trailing foot first
    for (const i of order) {
      if (swings[i]) continue
      const f = feet[i], other = swings[1 - i]
      const behind = (x - f.x) * dir
      const tooFar = Math.hypot(f.x - x, f.y - hipY) > REACH * 0.97
      const free = !other || (run > 0.5 && other.t > 0.55)
      if (moving && free && (behind > stepLen * mx(0.5, 0.35, run) || tooFar)) {
        const dur = mx(Math.min(0.42, Math.max(0.2, (0.6 * stepLen) / Math.max(speed, 24))), 0.2, run)
        const to = x + dir * (speed * dur * mx(0.5, 1, run) + stepLen * mx(0.5, 0.3, run))
        swings[i] = { from: [f.x, f.y], to, t: 0, dur }
      } else if (!moving && !other && Math.abs(feet[0].x - feet[1].x) > 10 && Math.abs(f.x - x) >= Math.abs(feet[1 - i].x - x)) {
        // Coming to a stop: bring the far foot in beside the other.
        swings[i] = { from: [f.x, f.y], to: x + (feet[1 - i].x < x ? 4 : -4), t: 0, dur: 0.3 }
      }
    }
    let air = 0 // how high the hip rides: up while a foot is passing under it
    swings.forEach((s, i) => {
      if (!s) return
      s.t = Math.min(1, s.t + dt / s.dur)
      const f = feet[i], e = smooth(s.t)
      f.x = mx(s.from[0], s.to, e)
      // Running, the heel kicks up behind and the knee drives through.
      const lift = mx(7, 24, run) * Math.sin(Math.PI * Math.pow(s.t, mx(1, 0.7, run)))
      f.y = Math.min(mx(s.from[1], ground(s.to), e), ground(f.x)) - lift // never through the letter
      air = Math.max(air, Math.sin(Math.PI * s.t))
      if (s.t >= 1) { f.x = s.to; f.y = ground(f.x); swings[i] = null }
    })
    phase += dt * Math.PI * speed / Math.max(stepLen, 1)

    const down = [0, 1].filter((i) => !swings[i])
    const under = down.length ? down.reduce((a, i) => a + feet[i].y, 0) / down.length : ground(x)
    const want = Math.min(under, ground(x)) - REACH * mx(WALK.height, RUN.height, run) - air * mx(2, 4, run) * SCALE
    hipY += (want - hipY) * Math.min(1, dt * mx(10, 14, run))
    if (run < 0.5) { // walking: never farther than a leg from a planted foot
      for (const i of down) {
        const dx = Math.abs(feet[i].x - x), r = REACH * 0.99
        if (dx < r) hipY = Math.max(hipY, feet[i].y - Math.sqrt(r * r - dx * dx))
      }
    }
  }

  // ---------------------------------------------------------------- startled
  function threat(px, py) {
    if (state >= S.PEEK) return // making his entrance: he isn't to be hurried
    const r = svgEl.getBoundingClientRect()
    if (Math.abs(py - (r.top + hipY)) > 120 || Math.abs(px - (r.left + x)) > 95) return
    if (performance.now() > fleeUntil) dir = px < r.left + x ? 1 : -1 // away from the hand
    fleeUntil = performance.now() + 2200
    state = S.RUN
  }
  const onPointer = (e) => threat(e.clientX, e.clientY)
  banner.addEventListener('pointermove', onPointer)
  banner.addEventListener('pointerdown', onPointer)
  const stop = () => {
    stopped = true
    cancelAnimationFrame(frame)
    resized.disconnect()
    banner.removeEventListener('pointermove', onPointer)
    banner.removeEventListener('pointerdown', onPointer)
    svgEl.replaceChildren()
  }
  let frame = 0

  // ---------------------------------------------------------------- reduced motion: seated on the 'h', still
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const still = () => {
      if (stopped) return
      const l = letters[4] || letters[letters.length - 1]
      x = l.cx; sitBlend = 1; state = S.SEATED; plantFeet()
      draw()
    }
    if (document.fonts) document.fonts.ready.then(still)
    still()
    return stop
  }

  // ---------------------------------------------------------------- the entrance
  // Peeking: down into the frame over 0.7s, a look one way and the other, back up in 0.35s. Hidden a
  // beat. Then the drop: from above the frame, under gravity, arms up and coat tails flying, the hat
  // drifting up off his head as he falls. Landing: feet planted on the letters, the hip sinks into
  // the knees and comes back up, the hat drops back on with a little bounce, and he strolls off.
  const HEAD_DOWN = (TORSO + NECK + HEAD) * SCALE // hip to the middle of his head
  const OUT_OF_SIGHT = -(TORSO + NECK + 2 * HEAD + 16) * SCALE - 8 // the hip, with his hat just above the frame
  const PEEKING = 34 - HEAD_DOWN // the hip, with the middle of his head 34px into the frame
  const GRAVITY = 1700 // px/s²
  let t0 = 0, fallV = 0, hatLift = 0, landDepth = 0

  // ---------------------------------------------------------------- the loop
  let last = performance.now()
  const tick = () => {
    if (stopped) return
    frame = requestAnimationFrame(tick)
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000)
    last = now

    if (state >= S.PEEK) { // the entrance: nothing else happens until he has landed
      t0 += dt
      if (state === S.PEEK) {
        const IN = 0.7, LOOK = 1.7, OUT = 0.35
        const depth = t0 < IN ? smooth(t0 / IN) : t0 < IN + LOOK ? 1 : 1 - smooth((t0 - IN - LOOK) / OUT)
        const look = t0 < IN ? 0 : t0 < IN + LOOK ? Math.sin(((t0 - IN) / LOOK) * Math.PI * 2) : 0
        draw(peekPose(look, mx(OUT_OF_SIGHT, PEEKING, depth)))
        if (t0 >= IN + LOOK + OUT) { state = S.HIDDEN; t0 = 0 }
      } else if (state === S.HIDDEN) {
        draw(peekPose(0, OUT_OF_SIGHT * 2))
        if (t0 >= 0.55) {
          state = S.DROP; t0 = 0; fallV = 0
          hipY = -(REACH + 40) // feet dangling just above the frame
        }
      } else if (state === S.DROP) {
        fallV += GRAVITY * dt
        hipY += fallV * dt
        phase += dt * 6
        hatLift = Math.min(7, hatLift + dt * 14)
        const dangle = REACH * 0.96
        feet[0].x = x - 5 * dir; feet[1].x = x + 6 * dir
        feet[0].y = hipY + dangle; feet[1].y = hipY + dangle - 6
        const floor = ground(x) - dangle
        if (hipY >= floor) { // touchdown: feet planted on the letters
          hipY = floor
          feet[0].y = ground(feet[0].x); feet[1].y = ground(feet[1].x)
          landDepth = Math.min(26 * SCALE, fallV * 0.045)
          state = S.LAND; t0 = 0
        }
        draw(walkPose(0, 0, { raise: 1, hatLift }))
      } else if (state === S.LAND) {
        const D = 0.55, u = Math.min(1, t0 / D)
        const stand = (feet[0].y + feet[1].y) / 2 - REACH * WALK.height
        const sink = u < 0.22 ? smooth(u / 0.22) : 1 - smooth((u - 0.22) / 0.78)
        hipY = stand + landDepth * sink
        const settle = Math.min(1, t0 / 0.32)
        // The hat comes down a beat late and bounces once on his head.
        const h = t0 < 0.32 ? hatLift * (1 - smooth(settle)) : 1.6 * Math.max(0, Math.sin(((t0 - 0.32) / 0.2) * Math.PI)) * (t0 < 0.52 ? 1 : 0)
        draw(walkPose(0, 0, { raise: 1 - smooth(Math.min(1, t0 / 0.35)), hatLift: h }))
        if (u >= 1) { state = S.STROLL; timer = 2 + Math.random() * 3; hatLift = 0; plantFeet() }
      }
      return
    }

    const fleeing = now < fleeUntil

    if (!fleeing && state === S.RUN) { state = S.STROLL; timer = 2 + Math.random() * 3 }

    let wantSpeed = 0 // where the gait is heading; speed eases toward it
    switch (state) {
      case S.STROLL:
        wantSpeed = WALK.speed
        timer -= dt
        if (timer <= 0) { target = letters[Math.floor(Math.random() * letters.length)]; state = S.APPROACH }
        break
      case S.APPROACH: {
        const d = target.cx - x
        if (Math.abs(d) > 1.5) dir = d < 0 ? -1 : 1
        wantSpeed = WALK.speed * Math.min(1, Math.abs(d) / 24) // decelerate onto the spot
        const gathered = !swings[0] && !swings[1] && Math.abs(feet[0].x - feet[1].x) <= 10
        if (Math.abs(d) < 1.5 && speed < 2 && gathered) {
          speed = 0; state = S.SITTING
          sit0 = { hipY, feet: feet.map((f) => ({ ...f })) }
        }
        break
      }
      case S.SITTING:
        sitBlend = Math.min(1, sitBlend + dt / 1.5)
        if (sitBlend >= 1) { state = S.SEATED; timer = 4 + Math.random() * 5 }
        break
      case S.SEATED:
        timer -= dt
        if (timer <= 0) state = S.RISING
        break
      case S.RISING:
        sitBlend = Math.max(0, sitBlend - dt / 1.2)
        if (sitBlend <= 0) { state = S.STROLL; timer = 3 + Math.random() * 4 }
        break
      case S.RUN:
        if (sitBlend > 0) sitBlend = Math.max(0, sitBlend - dt / 0.3) // up in a hurry, then run
        else wantSpeed = RUN.speed
        break
    }

    if (sitBlend === 0) {
      runBlend += ((state === S.RUN ? 1 : 0) - runBlend) * Math.min(1, dt * (state === S.RUN ? 7 : 1.6))
      speed += (wantSpeed - speed) * Math.min(1, dt * 5)
      const before = x
      x += dir * speed * dt
      if (state === S.APPROACH && (target.cx - before) * (target.cx - x) < 0) x = target.cx // never overshoot

      if (state === S.STROLL) { // the whole width of the header, back and forth
        if (x > width - 60 && dir > 0) dir = -1
        if (x < 60 && dir < 0) dir = 1
      } else if (state === S.RUN) { // leave one side, come back in from the other, feet and all
        const shift = x > width + 90 ? -(width + 180) : x < -90 ? width + 180 : 0
        if (shift) {
          x += shift
          for (const f of feet) { f.x += shift; f.y = ground(f.x) }
          for (const s of swings) if (s) { s.from[0] += shift; s.to += shift }
        }
      }
      stepFeet(dt)
    }
    draw()
  }
  draw(peekPose(0, OUT_OF_SIGHT * 2)) // out of sight until the first frame
  frame = requestAnimationFrame(tick)
  return stop
}
