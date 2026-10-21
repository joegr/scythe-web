import { useEffect, useId, useRef, useState, type ReactNode } from 'react'

export interface AutocompleteProps<T> {
  /** The words in the field (controlled: the page owns them, so they can live in the address). */
  value: string
  onChange: (value: string) => void
  /** Suggestions for what's typed. `signal` aborts when a newer keystroke replaces this search. */
  source: (q: string, signal: AbortSignal) => Promise<T[]>
  itemKey: (item: T) => string | number
  /** How one suggestion reads (React escapes it: a suggestion is text, never markup). */
  renderItem: (item: T) => ReactNode
  onSelect: (item: T) => void
  /** Enter with no suggestion picked: the whole search. */
  onSubmit?: (value: string) => void
  /** → or Tab at the end of the field fills it with this (the picked suggestion's words), to keep typing from. */
  complete?: (item: T) => string
  label: string
  placeholder?: string
  maxLength?: number
  wait?: number
  maxResults?: number
  minLength?: number
  emptyText?: string
  autoFocus?: boolean
}

/**
 * A search field with suggestions as it's typed. Arrow keys move through them, Enter takes one (or, with none picked,
 * submits), → or Tab completes the field from one, Escape closes. Only the latest search shows: an earlier one still
 * on its way is aborted.
 */
export default function Autocomplete<T>({
  value, onChange, source, itemKey, renderItem, onSelect, onSubmit, complete, label, placeholder, maxLength = 500,
  wait = 200, maxResults = 8, minLength = 2, emptyText = 'No matches.', autoFocus,
}: AutocompleteProps<T>) {
  const id = useId()
  const [items, setItems] = useState<T[]>([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [loading, setLoading] = useState(false)
  const typed = useRef(false) // suggestions follow typing, not a value set from outside (the address, a pick)
  const sourceRef = useRef(source)
  sourceRef.current = source

  useEffect(() => {
    if (!typed.current) return
    const q = value.trim()
    if (q.length < minLength) { setItems([]); setOpen(false); return }
    const ctl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      sourceRef.current(value, ctl.signal)
        .then((found) => { setItems(found.slice(0, maxResults)); setActive(-1); setOpen(true) })
        .catch(() => { if (!ctl.signal.aborted) { setItems([]); setOpen(false) } })
        .finally(() => { if (!ctl.signal.aborted) setLoading(false) })
    }, wait)
    return () => { clearTimeout(t); ctl.abort() }
  }, [value, wait, maxResults, minLength])

  const close = () => { setOpen(false); setActive(-1) }
  const take = (item: T) => { typed.current = false; close(); onSelect(item) }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const n = items.length
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!open) { if (n) setOpen(true); return }
      e.preventDefault()
      if (n) setActive((a) => ((a + (e.key === 'ArrowDown' ? 1 : -1)) % n + n) % n)
    } else if (e.key === 'Enter') {
      if (open && active >= 0 && items[active]) { e.preventDefault(); take(items[active]) } else { close(); onSubmit?.(value) }
    } else if ((e.key === 'Tab' || e.key === 'ArrowRight') && open && complete && n) {
      const el = e.currentTarget
      if (e.key === 'ArrowRight' && el.selectionStart !== value.length) return
      const words = complete(items[active >= 0 ? active : 0])
      if (words && words !== value) { e.preventDefault(); typed.current = true; onChange(words) }
    } else if (e.key === 'Escape') close()
  }

  const listId = `${id}-list`
  return (
    <div className="ac">
      <div className="row ac-field">
        <input className="field" role="combobox" aria-label={label} aria-autocomplete="list" aria-expanded={open}
          aria-controls={listId} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
          autoComplete="off" spellCheck={false} autoFocus={autoFocus} placeholder={placeholder} maxLength={maxLength}
          value={value} onChange={(e) => { typed.current = true; onChange(e.target.value) }} onKeyDown={onKeyDown}
          onFocus={() => { if (items.length && value.trim().length >= minLength) setOpen(true) }}
          onBlur={() => setTimeout(close, 120)} />
        {value && <button className="link" aria-label="Clear the search" onMouseDown={(e) => e.preventDefault()}
          onClick={() => { typed.current = false; setItems([]); close(); onChange('') }}>clear</button>}
      </div>
      {open && (
        <ul id={listId} className="list ac-list" role="listbox" aria-label={`${label}: suggestions`} aria-busy={loading}>
          {items.length === 0
            ? <li className="ac-none" role="option" aria-selected={false} aria-disabled>{emptyText}</li>
            : items.map((item, i) => (
              <li key={itemKey(item)} id={`${id}-${i}`} role="option" aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setActive(i)} onClick={() => take(item)}>
                {renderItem(item)}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
