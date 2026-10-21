/**
 * Scanning a printed card with a phone's camera (phones and tablets only). Scythe finds the card's four corners
 * (OpenCV, as opencv.js, loaded only when scanning) and warps the photo back to the card's own flat frame: the
 * inverse of the tilt the camera saw. Only that squared-up card goes to the team's server, which reads it with OCR
 * into a draft card: tag, cite, body, and the marks on the paper (underlines, highlighter, emphasis) as
 * spans over the body. The server doesn't keep the photo. What OCR reads becomes the card's source, and the card is
 * cut from it word for word.
 */
import opencvUrl from '@techstark/opencv-js/dist/opencv.js?url'
import { api, ApiError, config } from './api'
import type { SpanRec } from './doc'

export interface ScanDraft { tag: string; cite: string; body: string; text: string; markdown: string; spans: SpanRec[] }

/** A phone or tablet: a touch screen with a coarse pointer (or the browser says it's mobile). */
export function isMobile(): boolean {
  if (typeof window === 'undefined') return false
  const ua = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  return !!ua?.mobile || (matchMedia('(pointer: coarse)').matches && navigator.maxTouchPoints > 0)
}

export const cameraSupported = () => typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** The back camera at 4K: a card fills only part of the frame, and at 2560×1440 its small print and cite no longer
 *  read once squared up (measured: whole-text accuracy 0.76–0.90 against 1.0 at 4K). The still is capped at BIGGEST,
 *  which costs no words. This is what asks for camera permission. */
export function openCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 3840 }, height: { ideal: 2160 } },
  })
}

// ---------------------------------------------------------------- pictures, within a phone's memory
// iOS Safari caps the memory all a page's canvases may hold together. Past it, a new canvas comes back with no
// context, and a scan that makes canvases freely dies quietly a few seconds in. So: the live look reuses one small
// canvas, a picture is never kept larger than the server reads (BIGGEST), and big canvases are released once read.

/** The longest side a picture is kept at: what the server reads (scan.LONG_EDGE). */
export const BIGGEST = 3000

export const OUT_OF_MEMORY = 'This phone ran out of room for the picture. Close other tabs and try again.'

/** A 2D context, or a plain-words error when the browser has no canvas memory left. */
function context(canvas: HTMLCanvasElement, opts?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', opts) as CanvasRenderingContext2D | null
  if (!ctx) throw new Error(OUT_OF_MEMORY)
  return ctx
}

/** Give a canvas's memory back now rather than at the next collection (what iOS Safari counts). */
export function release(canvas: HTMLCanvasElement | null | undefined) {
  if (canvas) { canvas.width = 0; canvas.height = 0 }
}

/** `source` drawn on a new canvas, at most BIGGEST on its long side. */
function drawn(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
  const k = Math.min(1, BIGGEST / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * k)); canvas.height = Math.max(1, Math.round(h * k))
  context(canvas).drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function closeCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

/** The current frame, at most BIGGEST on its long side. */
export function still(video: HTMLVideoElement): HTMLCanvasElement {
  if (!video.videoWidth) throw new Error('The camera hasn’t shown a picture yet. Wait a moment and try again.')
  return drawn(video, video.videoWidth, video.videoHeight)
}

/** A saved photo, at most BIGGEST on its long side (the browser applies its EXIF turn). An <img> where
 *  createImageBitmap can't decode it (older Safari): both turn the photo upright. */
export async function photoCanvas(photo: Blob): Promise<HTMLCanvasElement> {
  try {
    const bmp = await createImageBitmap(photo, { imageOrientation: 'from-image' })
    try { return drawn(bmp, bmp.width, bmp.height) } finally { bmp.close() }
  } catch (e) {
    if ((e as Error).message === OUT_OF_MEMORY) throw e
  }
  const url = URL.createObjectURL(photo)
  try {
    const img = new Image()
    img.src = url
    await img.decode().catch(() => { throw new Error('That isn’t a photo this browser can open.') })
    return drawn(img, img.naturalWidth, img.naturalHeight)
  } finally {
    URL.revokeObjectURL(url)
  }
}

// ---------------------------------------------------------------- the team's server, awake
// A team's Scythe stops when nobody has used it for a few minutes and starts again on the next request, which takes
// a quarter of a minute (its database comes up first). A scan is exactly a few quiet minutes then a big upload, so
// the scanner wakes the server as it opens, keeps it awake while open, and sends the picture again if it lands while
// the server is still starting.

/** Ask the team's server to be up (its health check: no account, nothing read). Errors are ignored. */
export function wake() {
  // no-cors: the answer isn't read, and the request still reaches a server on another origin (local development).
  void fetch(`${config.apiBase()}/healthz`, { cache: 'no-store', mode: 'no-cors' }).catch(() => {})
}

/** A server starting up answers nothing, or 502, 503 or 504 from Fly's proxy. */
const starting = (e: unknown) => e instanceof ApiError && [0, 502, 503, 504].includes(e.status)

/** `send`, again while the server is still starting: up to WAKE_WAIT in all, `onWait` told when it waits. */
export const WAKE_WAIT = 30_000
export async function whileWaking<T>(send: () => Promise<T>, onWait?: () => void): Promise<T> {
  const until = Date.now() + WAKE_WAIT
  for (let pause = 2000; ; pause = Math.min(pause * 2, 8000)) {
    try { return await send() } catch (e) {
      if (!starting(e) || Date.now() + pause > until) throw e
      onWait?.()
      await new Promise((r) => setTimeout(r, pause))
    }
  }
}

/** A photo as it is (a page for the reader, not a card): the server reads the words, nothing more. */
export function readPhoto(photo: Blob, onWait?: () => void): Promise<ScanDraft> {
  const form = new FormData()
  form.append('photo', photo, 'card.jpg')
  return whileWaking(() => api<ScanDraft>('POST', '/scan', form), onWait)
}

// ---------------------------------------------------------------- the card's plane

type CV = typeof import('@techstark/opencv-js')
export interface Pt { x: number; y: number }
/** Corners in image pixels: top left, top right, bottom right, bottom left. */
export type Quad = [Pt, Pt, Pt, Pt]

declare const squared: unique symbol
/** A card warped flat. Only rectify() makes one, and only a RectifiedCard is read as a card. */
export interface RectifiedCard { readonly canvas: HTMLCanvasElement; readonly quad: Quad; readonly [squared]: true }

// opencv.js runs as a classic script, fetched only when scanning, and announces itself as the global `cv`. It isn't
// imported as a module: it's a thenable (an emscripten build), so awaiting its import never settles.
let loading: Promise<{ cv: CV }> | null = null
export function loadCv(): Promise<{ cv: CV }> {
  return loading ??= new Promise<{ cv: CV }>((resolve, reject) => {
    const started = Date.now()
    const ready = () => {
      const cv = (window as { cv?: CV }).cv
      if (cv && typeof cv.Mat === 'function') resolve({ cv })
      else if (Date.now() - started > 60_000) reject(new Error('Scythe’s scanner took too long to start.'))
      else setTimeout(ready, 50) // its runtime may already be up by now, so look rather than wait to be told
    }
    const script = document.createElement('script')
    script.src = opencvUrl
    script.async = true
    script.onload = ready
    script.onerror = () => reject(new Error('Scythe couldn’t load its scanner. Check your connection and try again.'))
    document.head.appendChild(script)
  }).catch((e) => { loading = null; throw e })
}

/** Order four points TL, TR, BR, BL: TL has the least x+y, BR the most; TR the least y−x, BL the most. */
export function order(pts: Pt[]): Quad {
  const by = (f: (p: Pt) => number) => [...pts].sort((a, b) => f(a) - f(b))
  const sum = by((p) => p.x + p.y), diff = by((p) => p.y - p.x)
  return [sum[0], diff[0], sum[3], diff[3]]
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
/** The flat card's size: the mean of opposite edges (the server checks the image against this). */
export function rectifiedSize([tl, tr, br, bl]: Quad): { w: number; h: number } {
  return { w: (dist(tl, tr) + dist(bl, br)) / 2, h: (dist(tl, bl) + dist(tr, br)) / 2 }
}

/** The whole frame, for a card that fills the picture (or when no edges were found: the corners can be dragged). */
export function frameQuad(w: number, h: number): Quad {
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]
}

// The one small canvas every look for the card draws into: the live look runs eight times a second, and a new canvas
// each time is what runs a phone out of canvas memory.
let looking: HTMLCanvasElement | null = null

/** The card's corners in a frame: edges → the largest convex four-sided contour covering a fair part of it. */
export function detectQuad(cv: CV, frame: HTMLCanvasElement | HTMLVideoElement, maxSide = 480): Quad | null {
  const W = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.width
  const H = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.height
  if (!W || !H) return null
  const k = Math.min(1, maxSide / Math.max(W, H))
  const small = (looking ??= document.createElement('canvas'))
  const w = Math.round(W * k), h = Math.round(H * k)
  if (small.width !== w || small.height !== h) { small.width = w; small.height = h }
  const ctx = context(small, { willReadFrequently: true })
  ctx.drawImage(frame, 0, 0, small.width, small.height)

  const src = cv.matFromImageData(ctx.getImageData(0, 0, small.width, small.height))
  const gray = new cv.Mat(), edges = new cv.Mat(), contours = new cv.MatVector(), hierarchy = new cv.Mat()
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U)
  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0)
    cv.Canny(gray, edges, 50, 150)
    cv.dilate(edges, edges, kernel)
    cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)
    let best: Pt[] | null = null, bestArea = 0.12 * small.width * small.height
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i), approx = new cv.Mat()
      cv.approxPolyDP(c, approx, 0.02 * cv.arcLength(c, true), true)
      const area = cv.contourArea(approx)
      if (approx.rows === 4 && area > bestArea && cv.isContourConvex(approx)) {
        bestArea = area
        best = Array.from({ length: 4 }, (_, j) => ({ x: approx.data32S[2 * j] / k, y: approx.data32S[2 * j + 1] / k }))
      }
      approx.delete(); c.delete()
    }
    return best && order(best)
  } finally {
    src.delete(); gray.delete(); edges.delete(); contours.delete(); hierarchy.delete(); kernel.delete()
  }
}

/**
 * Warp the photo so the quad becomes an upright rectangle: the homography quad → rectangle undoes the card's tilt in
 * space. The longest side is capped at `maxSide`, and the quad scaled with it, so the server can check the image
 * really is this quad's warp. (A quarter or half turn in the card's own plane is righted by the server.)
 */
export function rectify(cv: CV, photo: HTMLCanvasElement, quad: Quad, maxSide = 2400): RectifiedCard {
  const size = rectifiedSize(quad)
  const k = Math.min(1, maxSide / Math.max(size.w, size.h))
  const q = quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad
  const w = Math.round(size.w * k), h = Math.round(size.h * k)

  const src = cv.imread(photo), dst = new cv.Mat()
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, quad.flatMap((p) => [p.x, p.y]))
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, size.w * k, 0, size.w * k, size.h * k, 0, size.h * k])
  const M = cv.getPerspectiveTransform(from, to)
  const canvas = document.createElement('canvas')
  try {
    cv.warpPerspective(src, dst, M, new cv.Size(w, h), cv.INTER_CUBIC, cv.BORDER_REPLICATE, new cv.Scalar())
    cv.imshow(canvas, dst)
  } finally {
    src.delete(); dst.delete(); from.delete(); to.delete(); M.delete()
  }
  return { canvas, quad: q } as RectifiedCard
}

/** Read a squared-up card: the draft, with the marks on the paper as spans over its body. Nothing is kept. */
export async function readCard(card: RectifiedCard, onWait?: () => void): Promise<ScanDraft> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    card.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The camera gave no picture.'))), 'image/jpeg', 0.92))
  const form = new FormData()
  form.append('photo', blob, 'card.jpg')
  form.append('quad', JSON.stringify(card.quad.flatMap((p) => [p.x, p.y])))
  return whileWaking(() => api<ScanDraft>('POST', '/scan', form), onWait)
}

/** A picture as it is, when the scanner can't run here (it didn't load, or this phone ran out of room): the server
 *  reads the photo without squaring it up, so a card shot straight on still reads. */
export async function readPicture(canvas: HTMLCanvasElement, onWait?: () => void): Promise<ScanDraft> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The camera gave no picture.'))), 'image/jpeg', 0.92))
  return readPhoto(blob, onWait)
}

/** Tell the team's server a scan failed on this phone, and where: what the phone saw, never the picture. A report
 *  that can't be sent is dropped (it's only for the logs). */
export function reportScan(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  void api('POST', '/scan/report', { step, message: message.slice(0, 400), agent: navigator.userAgent.slice(0, 200) }).catch(() => {})
}
