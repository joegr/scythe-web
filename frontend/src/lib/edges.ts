/**
 * Finding the card in the camera's live picture, in the browser, the way an ID scanner outlines a card: a small copy of
 * the frame (LOOK pixels on its long side) is split into paper and background by brightness (Otsu's threshold), the
 * largest bright region is taken as the card, and its four corners are its extreme points along the diagonals. It is a
 * guide for the eye and for taking the picture at the right moment; the team's server still squares up the full photo.
 */

/** The long side of the copy the card is looked for in: small enough to look several times a second on a phone. */
export const LOOK = 200

/** Corners as fractions of the frame: TL TR BR BL, x y. */
export type Quad = [number, number, number, number, number, number, number, number]

/** The card's corners in a frame's pixels (RGBA, w × h), or null when no card-sized bright region is in view. */
export function findCard(rgba: Uint8ClampedArray, w: number, h: number): Quad | null {
  const n = w * h
  const gray = new Uint8Array(n)
  const hist = new Uint32Array(256)
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    const g = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8
    gray[i] = g
    hist[g]++
  }
  const t = otsu(hist, n)
  // Paper is the brighter side; a card on a white table has no edge to find.
  const bright = new Uint8Array(n)
  let count = 0
  for (let i = 0; i < n; i++) if (gray[i] > t) { bright[i] = 1; count++ }
  if (count < n * 0.12 || count > n * 0.92) return null

  // The largest 4-connected bright region.
  const label = new Int32Array(n).fill(-1)
  const stack = new Int32Array(n)
  let best = -1, bestSize = 0
  for (let s = 0; s < n; s++) {
    if (!bright[s] || label[s] !== -1) continue
    let top = 0, size = 0
    stack[top++] = s; label[s] = s
    while (top) {
      const p = stack[--top]; size++
      const x = p % w
      const next = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p - w, p + w]
      for (const q of next) {
        if (q >= 0 && q < n && bright[q] && label[q] === -1) { label[q] = s; stack[top++] = q }
      }
    }
    if (size > bestSize) { bestSize = size; best = s }
  }
  if (best < 0 || bestSize < n * 0.12) return null

  // Its corners: the extreme points along x + y and x − y.
  let tl = Infinity, br = -Infinity, tr = -Infinity, bl = Infinity
  let TL = 0, BR = 0, TR = 0, BL = 0
  for (let p = 0; p < n; p++) {
    if (label[p] !== best) continue
    const x = p % w, y = (p / w) | 0
    const sum = x + y, diff = x - y
    if (sum < tl) { tl = sum; TL = p }
    if (sum > br) { br = sum; BR = p }
    if (diff > tr) { tr = diff; TR = p }
    if (diff < bl) { bl = diff; BL = p }
  }
  const pt = (p: number) => [(p % w) / (w - 1), ((p / w) | 0) / (h - 1)]
  const quad = [...pt(TL), ...pt(TR), ...pt(BR), ...pt(BL)] as Quad
  // A card fills most of the quad its corners make (its print aside); a ragged region (a hand, a lamp’s glare) doesn’t.
  const area = quadArea(quad) * (w - 1) * (h - 1)
  if (area < n * 0.12 || bestSize < area * 0.6 || !convex(quad)) return null
  return quad
}

function otsu(hist: Uint32Array, n: number): number {
  let sum = 0
  for (let i = 0; i < 256; i++) sum += i * hist[i]
  let sumB = 0, wB = 0, best = 0, t = 127
  for (let i = 0; i < 256; i++) {
    wB += hist[i]
    if (!wB) continue
    const wF = n - wB
    if (!wF) break
    sumB += i * hist[i]
    const mB = sumB / wB, mF = (sum - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > best) { best = between; t = i }
  }
  return t
}

/** The area of a quad in the frame's fractions (shoelace). */
export function quadArea(q: Quad): number {
  let a = 0
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    a += q[2 * i] * q[2 * j + 1] - q[2 * j] * q[2 * i + 1]
  }
  return Math.abs(a) / 2
}

function convex(q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = [q[2 * i], q[2 * i + 1]]
    const [bx, by] = [q[(2 * i + 2) % 8], q[(2 * i + 3) % 8]]
    const [cx, cy] = [q[(2 * i + 4) % 8], q[(2 * i + 5) % 8]]
    const z = (bx - ax) * (cy - by) - (by - ay) * (cx - bx)
    if (z === 0) continue
    if (sign && Math.sign(z) !== sign) return false
    sign = Math.sign(z)
  }
  return true
}

/** How far two quads' corners are apart at most, in frame fractions: what "holding still" is measured by. */
export function drift(a: Quad, b: Quad): number {
  let m = 0
  for (let i = 0; i < 8; i++) m = Math.max(m, Math.abs(a[i] - b[i]))
  return m
}
