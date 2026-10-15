import clsx from 'clsx'
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, useAsk } from '@/api/client'
import type { AskAnswer, AskToolCall } from '@/api/types'
import { parseCommand } from '@/lib/command'
import { fmtDate } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { ErrorState, SectionTitle } from '@/ui/primitives'
import type { FnProps } from './types'

const EXAMPLES = [
  'How steep is the US Treasury curve compared with a year ago?',
  'Is Ferrari expensive compared with its own history and its peers?',
  'What is the BTP–Bund spread doing and why might it matter?',
  'Compare euro-area and US inflation over the last year.',
]

const TOOL_LABEL: Record<string, string> = {
  search_securities: 'Search',
  get_profile: 'Profile',
  get_price_history: 'Price history',
  get_financials: 'Financial statements',
  get_earnings: 'Earnings & estimates',
  get_news: 'News',
  get_quotes: 'Quotes',
  get_yield_curve: 'Yield curve',
  get_sovereign_spreads: 'Sovereign spreads',
  get_macro_series: 'Macro series',
  get_fx_rate: 'FX rate',
  screen_equities: 'Screener',
}

/** The terminal command that shows the same data, so any figure can be checked. */
export function commandFor(call: AskToolCall): string | null {
  const i = call.input as Record<string, string | string[]>
  const sym = typeof i.symbol === 'string' ? i.symbol.toUpperCase() : ''
  switch (call.tool) {
    case 'get_profile':
      return `${sym} DES`
    case 'get_price_history':
      return `${sym} GP`
    case 'get_financials':
      return `${sym} FA ${({ income: 'IS', balance: 'BS', cashflow: 'CF' } as Record<string, string>)[String(i.statement)] ?? ''}${i.period === 'quarterly' ? ' Q' : ''}`.trim()
    case 'get_earnings':
      return `${sym} ERN`
    case 'get_news':
      return sym ? `${sym} NEWS` : 'NEWS'
    case 'get_yield_curve':
      return `YC ${i.region}`
    case 'get_sovereign_spreads':
      return `SOV ${(Array.isArray(i.countries) ? i.countries : []).join(' ')}`.trim()
    case 'get_macro_series':
      return `ECO ${String(i.series_id).toUpperCase()}`
    case 'get_fx_rate':
      return `FX ${String(i.base).toUpperCase()}${String(i.quote).toUpperCase()}`
    case 'screen_equities':
      return `EQS ${i.query}`
    default:
      return null
  }
}

interface Entry {
  question: string
  answer?: AskAnswer
  error?: unknown
}

export function Ask({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const run = useWorkspace((s) => s.run)
  const mutation = useAsk()
  const [draft, setDraft] = useState('')
  const [entries, setEntries] = useState<Entry[]>([])
  const bottom = useRef<HTMLDivElement>(null)

  const submit = (question: string) => {
    const q = question.trim()
    if (q.length < 3 || mutation.isPending) return
    setDraft('')
    setEntries((e) => [...e, { question: q }])
    mutation.mutate(
      { question: q, security: pane.security },
      {
        onSuccess: (r) =>
          setEntries((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, answer: r.data } : x))),
        onError: (err) =>
          setEntries((e) => e.map((x, i) => (i === e.length - 1 ? { ...x, error: err } : x))),
      },
    )
  }

  // A question typed on the command line (ASK …) runs once, then is cleared from the saved
  // pane settings so a page reload never re-runs a paid request.
  const pending = pane.params.q
  const handled = useRef<string | null>(null) // React may run effects twice in development
  useEffect(() => {
    if (!pending || handled.current === pending) return
    handled.current = pending
    setParams(pane.id, { q: '' })
    submit(pending)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [entries])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="pane-scroll min-h-0 flex-1 px-3 py-2">
        {entries.length === 0 && (
          <div className="mx-auto max-w-2xl py-6 text-center">
            <div className="text-[13px] text-fg">
              Ask about markets, companies, rates or the economy.
            </div>
            <p className="mt-1 text-fg-3">
              Claude answers with Tessera's own data — every figure comes from a terminal function
              and is cited with its source and date.
              {pane.security && (
                <>
                  {' '}
                  Context: <span className="num text-amber">{pane.security}</span>.
                </>
              )}
            </p>
            <div className="mt-3 flex flex-col items-center gap-1">
              {EXAMPLES.map((e) => (
                <button
                  key={e}
                  type="button"
                  onClick={() => submit(e)}
                  className="rounded-[3px] border border-line px-2 py-0.5 text-[11px] text-fg-2 hover:border-amber-dim hover:text-amber"
                >
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        {entries.map((entry, i) => (
          <div key={i} className="mb-4">
            <div className="mb-1.5 text-[12.5px] text-amber">› {entry.question}</div>
            {entry.answer ? (
              <AnswerView
                a={entry.answer}
                onOpen={(cmd) => run(parseCommand(cmd), { newPane: true, raw: cmd })}
              />
            ) : entry.error ? (
              <div className="rounded-[3px] border border-line">
                <ErrorState
                  error={entry.error}
                  hint={
                    entry.error instanceof ApiError && entry.error.status === 503
                      ? 'Add ANTHROPIC_API_KEY to .env in the project root and restart `make dev`.'
                      : undefined
                  }
                />
              </div>
            ) : (
              <div className="flex items-center gap-2 text-fg-3">
                <span className="size-1.5 animate-pulse rounded-full bg-amber" />
                Researching with Tessera's data…
              </div>
            )}
          </div>
        ))}
        <div ref={bottom} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit(draft)
        }}
        className="flex shrink-0 items-end gap-1.5 border-t border-line px-2 py-1.5"
      >
        <textarea
          value={draft}
          rows={2}
          aria-label="Question"
          placeholder="Ask a question… (Enter to send, Shift+Enter for a new line)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit(draft)
            }
          }}
          className="min-w-0 flex-1 resize-none rounded-[3px] border border-line bg-canvas px-2 py-1 text-[12px] text-fg placeholder:text-fg-4 focus:border-amber-dim focus:outline-none"
        />
        <button
          type="submit"
          disabled={mutation.isPending || draft.trim().length < 3}
          className="h-[26px] rounded-[3px] border border-amber-dim bg-amber/10 px-3 text-[11px] text-amber enabled:hover:bg-amber/20 disabled:opacity-40"
        >
          Ask
        </button>
      </form>
    </div>
  )
}

/** Minimal formatting for model text: paragraphs, "- " bullets and **bold**. */
function RichText({ text }: { text: string }) {
  const inline = (s: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={i} className="font-semibold text-fg">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{part}</Fragment>
      ),
    )
  return (
    <div className="space-y-2 leading-relaxed text-fg-2">
      {text.split(/\n{2,}/).map((block, i) => {
        const lines = block.split('\n')
        return lines.every((l) => /^\s*[-•*]\s+/.test(l)) ? (
          <ul key={i} className="list-disc space-y-0.5 pl-5">
            {lines.map((l, j) => (
              <li key={j}>{inline(l.replace(/^\s*[-•*]\s+/, ''))}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{inline(block)}</p>
        )
      })}
    </div>
  )
}

function AnswerView({ a, onOpen }: { a: AskAnswer; onOpen: (command: string) => void }) {
  return (
    <div className="rounded-[3px] border border-line bg-raised/30 px-3 py-2">
      <RichText text={a.answer} />
      {a.tool_calls.length > 0 && (
        <>
          <SectionTitle>How this was answered</SectionTitle>
          <table className="dt">
            <tbody>
              {a.tool_calls.map((c, i) => {
                const cmd = commandFor(c)
                return (
                  <tr key={i}>
                    <td className={clsx('w-36', c.ok ? 'text-fg-2' : 'text-down')}>
                      {TOOL_LABEL[c.tool] ?? c.tool}
                    </td>
                    <td
                      className="num max-w-0 truncate !text-left text-fg-3"
                      title={JSON.stringify(c.input)}
                    >
                      {Object.values(c.input)
                        .map((v) => (Array.isArray(v) ? v.join(', ') : String(v)))
                        .join(' · ')}
                    </td>
                    <td className="!text-left text-[10.5px] text-fg-3">
                      {c.ok
                        ? `${c.source ?? ''}${c.as_of ? ` · ${fmtDate(c.as_of)}` : ''}`
                        : c.error}
                    </td>
                    <td className="w-12">
                      {cmd && (
                        <button
                          type="button"
                          title={`Open ${cmd} in a new pane to check the data`}
                          onClick={() => onOpen(cmd)}
                          className="text-[10.5px] text-fg-3 hover:text-amber"
                        >
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </>
      )}
      <div className="num mt-2 text-[10px] text-fg-4">
        {a.model} · {a.steps} step{a.steps === 1 ? '' : 's'} ·{' '}
        {a.input_tokens.toLocaleString('en-US')} in ({a.cache_read_tokens.toLocaleString('en-US')}{' '}
        cached) / {a.output_tokens.toLocaleString('en-US')} out tokens · generated text — verify
        figures via Open
      </div>
    </div>
  )
}
