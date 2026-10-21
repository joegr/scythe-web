/** The undertaker (undertaker.js, identical to scythe-landing/site/undertaker.js): he peeks in from the top of the
 *  banner, drops onto the wordmark's letters and strolls along them. Returns a function that stops him. */
export function mountUndertaker(els: { svg: SVGSVGElement | null; banner: HTMLElement | null; wordmark: HTMLElement | null }): () => void
