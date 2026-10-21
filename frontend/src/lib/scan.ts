/**
 * Scanning a card. A screenshot goes to the team's server as it is, to be read; a photo of paper goes as the camera
 * took it, and the server finds the card's four corners, squares it up (the inverse of the tilt the camera saw), turns
 * it upright and reads it. Either way the server keeps what it read as the member's own draft: tag, cite, body, and
 * the marks on the paper (underlines, highlighter, emphasis) as spans over the body. Never the picture. The member
 * checks it, marks it and saves it; what OCR read becomes the card's source, and the card is cut from it word for word.
 */
import { api, ApiError, config } from './api'
import type { SpanRec } from './doc'

export interface ScanDraft { tag: string; cite: string; body: string; text: string; markdown: string; spans: SpanRec[] }
export type ScanKind = 'screenshot' | 'photo'
/** A scan waiting for its member: what the server read. `corners`: where it squared a photo up to, as fractions of the
 *  upright photo (TL TR BR BL, x y), for dragging. */
export interface Draft extends ScanDraft { id: number; kind: ScanKind; corners: number[] | null; created_at: string }

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

// ---------------------------------------------------------------- screenshot or photo
// A screenshot is read as it is; a photo of paper is squared up first. Scythe tells them apart by what the file says:
// a camera writes its make and model (EXIF) into every photo, and a screenshot is a PNG (iPhone, Android, Mac) with
// no camera in it. A JPEG with no camera named is read as a photo, which still reads a screenshot well (the server
// finds no corners and reads it whole). The server checks the EXIF again, and the member can switch it.

/** Whether a JPEG's EXIF names a camera (Make 0x010F or Model 0x0110 in IFD0). Reads only the file's first 128 KB. */
export function cameraExif(bytes: Uint8Array): boolean {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return false
  for (let i = 2; i + 4 <= v.byteLength;) {
    if (v.getUint8(i) !== 0xff) return false
    const marker = v.getUint8(i + 1), size = v.getUint16(i + 2)
    if (marker === 0xe1 && i + 10 <= v.byteLength && v.getUint32(i + 4) === 0x45786966) { // "Exif"
      const t = i + 10
      if (t + 8 > v.byteLength) return false
      const le = v.getUint16(t) === 0x4949
      const ifd = t + v.getUint32(t + 4, le)
      if (ifd + 2 > v.byteLength) return false
      const n = v.getUint16(ifd, le)
      for (let k = 0; k < n && ifd + 2 + 12 * (k + 1) <= v.byteLength; k++) {
        const tag = v.getUint16(ifd + 2 + 12 * k, le)
        if (tag === 0x010f || tag === 0x0110) return true
      }
      return false
    }
    if (marker === 0xda) return false // the image data: no EXIF before it
    i += 2 + size
  }
  return false
}

/** What kind of picture a chosen file is: a PNG or WebP with no camera in it is a screenshot; anything else, a photo. */
export async function kindOf(file: Blob): Promise<ScanKind> {
  const head = new Uint8Array(await file.slice(0, 128 * 1024).arrayBuffer())
  const png = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47
  const webp = head[0] === 0x52 && head[1] === 0x49 && head[8] === 0x57 && head[9] === 0x45
  return (png || webp) && !cameraExif(head) ? 'screenshot' : 'photo'
}

/** The camera's current frame as a JPEG, at most BIGGEST on its long side; its canvas is released at once. */
export async function stillPhoto(video: HTMLVideoElement): Promise<Blob> {
  const canvas = still(video)
  try {
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(OUT_OF_MEMORY))), 'image/jpeg', 0.92))
  } finally { release(canvas) }
}

// ---------------------------------------------------------------- the team's server: reading, and the queue

export const MAX_BYTES = 12 * 1024 * 1024 // what the server takes (scan.MAX_BYTES)

/** Send a picture to be read as `kind` (the file as it is: no canvas, nothing re-encoded), into a draft. `replaces`:
 *  one of the member's drafts this reads again; `corners`: for a photo, where to square it up to (fractions). */
export function readScan(picture: Blob, kind: ScanKind, opts: { replaces?: number; corners?: number[]; onWait?: () => void } = {}): Promise<Draft> {
  if (picture.size > MAX_BYTES) return Promise.reject(new Error('That picture is too large (12 MB at most).'))
  const form = new FormData()
  form.append('photo', picture, kind === 'screenshot' ? 'screenshot.png' : 'photo.jpg')
  if (opts.replaces !== undefined) form.append('replaces', String(opts.replaces))
  if (opts.corners) form.append('corners', JSON.stringify(opts.corners))
  return whileWaking(() => api<Draft>('POST', `/scan/${kind}`, form), opts.onWait)
}

export const listDrafts = () => api<Draft[]>('GET', '/scan/drafts')
export const getDraft = (id: number) => api<Draft>('GET', `/scan/drafts/${id}`)
export const editDraft = (id: number, patch: { tag?: string; cite?: string; spans?: { style: string; start_char: number; end_char: number }[] }) =>
  api<Draft>('PATCH', `/scan/drafts/${id}`, patch)
export const discardDraft = (id: number) => api<null>('DELETE', `/scan/drafts/${id}`)

/** Tell the team's server a scan failed on this phone, and where: what the phone saw, never the picture. A report
 *  that can't be sent is dropped (it's only for the logs). */
export function reportScan(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  void api('POST', '/scan/report', { step, message: message.slice(0, 400), agent: navigator.userAgent.slice(0, 200) }).catch(() => {})
}
