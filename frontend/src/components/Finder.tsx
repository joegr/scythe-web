import { useEffect, useRef, useState } from 'react'
import { drift, findCard, LOOK, quadArea, type Quad } from '../lib/edges'

const EVERY = 150 // ms between looks
const STEADY = 6 // looks the card must hold still for (about a second) before the picture is taken
const STILL = 0.02 // how far a corner may move between looks and still be "still", as a fraction of the frame
const BIG_ENOUGH = 0.18 // the card must fill this much of the frame to be read well

/** Over the live camera, as an ID scanner does: a frame to fit the card in with a guide line across it, the card's
 *  outline once it's found, and the picture taken by itself when the card holds still (once per card: it waits for the
 *  card to leave or move before taking another). */
export default function Finder({ video, live, onSteady }: { video: React.RefObject<HTMLVideoElement | null>; live: boolean; onSteady: () => void }) {
  const [quad, setQuad] = useState<Quad | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [steady, setSteady] = useState(0)
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const fire = useRef(onSteady)
  fire.current = onSteady

  useEffect(() => {
    if (!live) { setQuad(null); setSteady(0); return }
    let last: Quad | null = null, still = 0, armed = true, gone = 0
    const look = () => {
      const v = video.current
      if (!v || !v.videoWidth) return
      const k = LOOK / Math.max(v.videoWidth, v.videoHeight)
      const w = Math.round(v.videoWidth * k), h = Math.round(v.videoHeight * k)
      // One small canvas for every look (iOS Safari caps the memory a page's canvases may hold).
      const c = (canvas.current ??= document.createElement('canvas'))
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; setSize({ w: v.videoWidth, h: v.videoHeight }) }
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(v, 0, 0, w, h)
      const q = findCard(ctx.getImageData(0, 0, w, h).data, w, h)
      if (!q || quadArea(q) < BIG_ENOUGH) {
        still = 0; last = null
        if (++gone >= 3) armed = true // the card left: the next one may be taken
        setQuad(q); setSteady(0)
        return
      }
      gone = 0
      if (last && drift(last, q) > 0.1) armed = true // moved to another card
      still = last && drift(last, q) < STILL ? still + 1 : 0
      last = q
      setQuad(q); setSteady(Math.min(still, STEADY))
      if (armed && still >= STEADY) { armed = false; still = 0; fire.current() }
    }
    const timer = setInterval(look, EVERY)
    return () => { clearInterval(timer); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0 } }
  }, [live, video])

  const still = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!live || !size) return null
  const { w, h } = size
  // The guide: a frame inset from the picture's edges, the rest dimmed.
  const gx = w * 0.06, gy = h * 0.08, gw = w - 2 * gx, gh = h - 2 * gy
  const arm = Math.min(gw, gh) * 0.12
  const brackets = [
    `M${gx},${gy + arm}V${gy}H${gx + arm}`, `M${gx + gw - arm},${gy}H${gx + gw}V${gy + arm}`,
    `M${gx + gw},${gy + gh - arm}V${gy + gh}H${gx + gw - arm}`, `M${gx + arm},${gy + gh}H${gx}V${gy + gh - arm}`,
  ]
  const pts = quad ? [0, 1, 2, 3].map((i) => `${quad[2 * i] * w},${quad[2 * i + 1] * h}`).join(' ') : ''
  const say = !quad ? 'Fit the card inside the frame' : steady >= STEADY ? 'Got it' : 'Hold still…'
  return (
    <>
      <svg className="finder" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path className="finder-dim" fillRule="evenodd" d={`M0,0H${w}V${h}H0Z M${gx},${gy}V${gy + gh}H${gx + gw}V${gy}Z`} />
        {brackets.map((d) => <path key={d} className="finder-bracket" d={d} />)}
        {!quad && (
          <line className="finder-guide" x1={gx + arm} x2={gx + gw - arm} y1={gy + gh / 2} y2={gy + gh / 2}>
            {/* The guide line sweeps the frame, unless motion is turned down: then it rests across the middle. */}
            {!still && <animateTransform attributeName="transform" type="translate" dur="2.4s" repeatCount="indefinite"
              values={`0,${-gh * 0.4};0,${gh * 0.4};0,${-gh * 0.4}`} />}
          </line>
        )}
        {quad && <polygon className={`finder-card${steady >= STEADY ? ' done' : ''}`} points={pts} />}
      </svg>
      <p className="finder-say" role="status">{say}</p>
    </>
  )
}
