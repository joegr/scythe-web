import { useEffect, useRef, useState } from 'react'
import { bookmarklet } from '../lib/bookmarklet'

/** The "Read in Scythe" bookmark, to drag to the bookmarks bar, with what it's for in one sentence. */
export default function ReadHere({ account = false }: { account?: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const [clicked, setClicked] = useState(false)
  // Set by hand: React won't render a javascript: link, and this one is meant to be one.
  useEffect(() => { ref.current?.setAttribute('href', bookmarklet()) }, [])
  return (
    <div className="gap read-here">
      <p>
        <a ref={ref} className="link" draggable onClick={(e) => { e.preventDefault(); setClicked(true) }}>Read in Scythe</a>
        {' '}{account
          ? 'Drag this to your bookmarks bar. On an article Scythe can’t read, click it to read it here.'
          : 'Or drag this to your bookmarks bar, then click it on the article: it brings the page you’re reading here.'}
      </p>
      {clicked && <p className="note">It works from your bookmarks bar, on the article’s page. Drag it there first.</p>}
    </div>
  )
}
