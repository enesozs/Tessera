import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { fetchSearch, useSearch } from '@/api/client'
import { BY_CODE, FUNCTIONS, isFunctionCode } from '@/functions/registry'
import { parseCommand, tokenize } from '@/lib/command'
import { useActiveWorkspace, useWorkspace } from '@/state/workspace'

interface Suggestion {
  key: string
  /** Text placed in the input on Tab. */
  text: string
  /** Command executed on Enter / click. */
  run: string
  label: string
  detail?: string
  tag: string
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function CommandBar() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const [error, setError] = useState<string | null>(null)
  const run = useWorkspace((s) => s.run)
  const queryClient = useQueryClient()
  const history = useWorkspace((s) => s.history)
  const ws = useActiveWorkspace()
  const activeIndex = ws.panes.findIndex((p) => p.id === ws.activePaneId)
  const activePane = ws.panes[activeIndex]

  const tokens = tokenize(value)
  const searchTerm = tokens.length === 1 && !value.endsWith(' ') ? value.trim() : ''
  const debounced = useDebounced(searchTerm, 140)
  const search = useSearch(debounced)
  const hits = debounced && debounced === searchTerm ? (search.data?.data ?? []) : []

  const suggestions = useMemo<Suggestion[]>(() => {
    const out: Suggestion[] = []
    if (tokens.length === 0) {
      return history
        .slice(0, 8)
        .map((h) => ({ key: `h:${h}`, text: h, run: h, label: h, tag: 'recent' }))
    }
    const [first, second] = tokens
    const typingFirst = tokens.length === 1 && !value.endsWith(' ')

    if (typingFirst) {
      const q = first.toLowerCase()
      for (const f of FUNCTIONS) {
        if (f.code.startsWith(first) || (q.length > 2 && f.title.toLowerCase().includes(q)))
          out.push({
            key: `f:${f.code}`,
            text: `${f.code} `,
            run: f.code,
            label: f.code,
            detail: f.title,
            tag: 'function',
          })
      }
      for (const h of hits)
        out.push({
          key: `s:${h.symbol}`,
          text: `${h.symbol} `,
          run: h.symbol,
          label: h.symbol,
          detail: [h.name, h.exchange, h.type].filter(Boolean).join(' · '),
          tag: 'security',
        })
    } else if (isFunctionCode(first) && !(second && isFunctionCode(second))) {
      for (const e of BY_CODE[first].examples)
        if (e.startsWith(tokens.join(' ')))
          out.push({
            key: `e:${e}`,
            text: e,
            run: e,
            label: e,
            detail: BY_CODE[first].syntax,
            tag: 'example',
          })
    } else {
      const partial = tokens.length === 2 && !value.endsWith(' ') ? second : ''
      for (const f of FUNCTIONS)
        if (f.security && f.code.startsWith(partial))
          out.push({
            key: `sf:${f.code}`,
            text: `${first} ${f.code} `,
            run: `${first} ${f.code}`,
            label: `${first} ${f.code}`,
            detail: f.title,
            tag: 'function',
          })
    }
    return out.slice(0, 12)
  }, [tokens.join(' '), value, hits, history]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => setHighlight(-1), [value])
  useEffect(() => {
    if (!error) return
    const t = setTimeout(() => setError(null), 5000)
    return () => clearTimeout(t)
  }, [error])

  const execute = (text: string, newPane: boolean) => {
    const err = run(parseCommand(text), { newPane, raw: text.trim().toUpperCase() })
    if (err) setError(err)
    else {
      setValue('')
      setError(null)
      inputRef.current?.blur()
    }
  }

  const submit = async (newPane: boolean) => {
    if (highlight >= 0 && suggestions[highlight])
      return execute(suggestions[highlight].run, newPane)
    const parsed = parseCommand(value)
    // "ferrari" ⏎ — a name rather than a ticker: take the best search match. Typed tickers
    // ("aapl") match a search hit exactly and run as typed.
    const looksLikeName = /[a-z]/.test(value) || /^[A-Z]{6,}$/.test(value.trim())
    if (parsed.kind === 'security' && looksLikeName) {
      const term = value.trim()
      const results =
        debounced === term && search.data
          ? search.data.data
          : await queryClient
              .fetchQuery({ queryKey: ['search', term], queryFn: () => fetchSearch(term) })
              .then((r) => r.data)
              .catch(() => [])
      if (results.length && !results.some((h) => h.symbol === parsed.security))
        return execute(results[0].symbol, newPane)
    }
    execute(value, newPane)
  }

  // Global shortcuts. The command line owns them because most end by focusing it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useWorkspace.getState()
      const target = e.target as HTMLElement
      const inField =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const digit = /^Digit([1-6])$/.exec(e.code)
        const actions: Record<string, () => void> = {
          KeyM: () => s.toggleMaximize(),
          KeyW: () => s.closePane(),
          KeyN: () => s.splitPane(),
          KeyL: () => s.cycleLink(),
          BracketLeft: () => s.cycleWorkspace(-1),
          BracketRight: () => s.cycleWorkspace(1),
        }
        if (digit) {
          e.preventDefault()
          s.focusPaneIndex(Number(digit[1]) - 1)
        } else if (actions[e.code]) {
          e.preventDefault()
          actions[e.code]()
        }
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        return
      }
      if (inField) return
      if (e.key === '/' || e.key === '`') {
        e.preventDefault()
        inputRef.current?.focus()
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && /[\w^.\-=]/.test(e.key)) {
        // Typing anywhere goes to the command line, as on a hardware terminal keyboard.
        e.preventDefault()
        setValue((v) => v + e.key)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const open = focused && suggestions.length > 0
  const parsed = parseCommand(value)
  const preview =
    parsed.kind === 'function'
      ? `${parsed.security ?? ''} ${parsed.fn} · ${BY_CODE[parsed.fn].title}`.trim()
      : parsed.kind === 'security'
        ? `load ${parsed.security}`
        : null

  return (
    <div className="relative z-40 flex h-[38px] shrink-0 items-center gap-2 border-b border-line bg-surface px-2">
      <div
        className={clsx(
          'flex h-[28px] flex-1 items-center gap-2 rounded-[3px] border bg-canvas px-2 transition-colors',
          focused ? 'border-amber-dim' : 'border-line',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        <span className="num text-[13px] font-bold text-amber">›</span>
        <input
          ref={inputRef}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="Command"
          placeholder="Ticker, function or both — RACE GP · YC EA · AAPL FA · HELP"
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setHighlight((h) => Math.min(suggestions.length - 1, h + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setHighlight((h) => Math.max(-1, h - 1))
            } else if (e.key === 'Tab') {
              const pick = suggestions[Math.max(0, highlight)]
              if (pick) {
                e.preventDefault()
                setValue(pick.text)
              }
            } else if (e.key === 'Enter') {
              e.preventDefault()
              void submit(e.shiftKey)
            } else if (e.key === 'Escape') {
              if (value) setValue('')
              else inputRef.current?.blur()
            }
          }}
          className="num h-full min-w-0 flex-1 bg-transparent text-[13px] tracking-wide text-fg uppercase caret-amber outline-none placeholder:text-fg-4 placeholder:normal-case placeholder:tracking-normal"
        />
        {error ? (
          <span className="truncate text-[11px] text-down">{error}</span>
        ) : (
          preview && (
            <span className="num hidden truncate text-[11px] text-fg-3 sm:inline">{preview}</span>
          )
        )}
      </div>
      <div
        className="hidden shrink-0 items-center gap-1.5 text-[10.5px] text-fg-3 md:flex"
        title="Commands run in the active pane"
      >
        <span>→ pane</span>
        <span className="num text-amber">{activeIndex + 1}</span>
        {activePane?.fn && (
          <span className="num text-fg-2">
            {activePane.fn}
            {activePane.security && BY_CODE[activePane.fn].security
              ? ` ${activePane.security}`
              : ''}
          </span>
        )}
        <span className="ml-2 text-fg-4">⏎ here · ⇧⏎ new pane</span>
      </div>

      {open && (
        <ul className="absolute top-[34px] left-2 z-50 max-h-[60vh] w-[min(640px,calc(100%-1rem))] overflow-auto rounded-[3px] border border-line-strong bg-raised py-1 shadow-2xl shadow-black/60">
          {suggestions.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlight(i)}
                onClick={(e) => execute(s.run, e.shiftKey)}
                className={clsx(
                  'flex w-full items-center gap-3 px-2.5 py-1 text-left',
                  i === highlight && 'bg-hover',
                )}
              >
                <span
                  className={clsx(
                    'num min-w-20 font-semibold',
                    s.tag === 'security' ? 'text-fg' : 'text-amber',
                  )}
                >
                  {s.label}
                </span>
                <span className="min-w-0 flex-1 truncate text-fg-2">{s.detail}</span>
                <span className="text-[9.5px] tracking-wider text-fg-4 uppercase">{s.tag}</span>
              </button>
            </li>
          ))}
          <li className="mt-1 border-t border-line px-2.5 pt-1 text-[10px] text-fg-4">
            ↑↓ select · Tab complete · ⏎ run · ⇧⏎ new pane · Esc close
          </li>
        </ul>
      )}
    </div>
  )
}
