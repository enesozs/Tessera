import { useState } from 'react'
import { fetchSearch, useQuotes } from '@/api/client'
import { isTicker } from '@/lib/command'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Empty, Spacer, Toolbar } from '@/ui/primitives'
import { QuoteTable } from './QuoteTable'
import type { FnProps } from './types'

export function Watchlist({ pane }: FnProps) {
  const watchlist = useWorkspace((s) => s.watchlist)
  const add = useWorkspace((s) => s.addToWatchlist)
  const remove = useWorkspace((s) => s.removeFromWatchlist)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const query = useQuotes(watchlist.map((w) => w.symbol))
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const text = draft.trim()
    if (!text) return
    setError(null)
    // Accept a ticker or a name: resolve through search and prefer an exact symbol match.
    try {
      const hits = (await fetchSearch(text)).data
      const symbol = text.toUpperCase()
      const hit = hits.find((h) => h.symbol === symbol) ?? (isTicker(symbol) ? undefined : hits[0])
      if (!hit && !isTicker(symbol)) throw new Error(`No match for "${text}"`)
      add({ symbol: hit?.symbol ?? symbol, name: hit?.name })
      setDraft('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Search failed')
    }
  }

  const bySymbol = new Map(query.data?.data.map((q) => [q.symbol, q]) ?? [])
  const latest = query.data?.data
    .map((q) => q.as_of)
    .sort()
    .at(-1)

  return (
    <FnFrame
      query={query}
      idle={<Empty>Your watchlist is empty. Add a ticker above or type WL ADD NVDA.</Empty>}
      toolbar={
        <Toolbar>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
            className="flex items-center gap-1.5"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Add ticker or name…"
              className="num h-[22px] w-44 rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg uppercase placeholder:text-fg-4 placeholder:normal-case focus:border-amber-dim focus:outline-none"
            />
            <button
              type="submit"
              className="h-[22px] rounded-[3px] border border-line px-2 text-[10.5px] text-fg-2 hover:border-line-strong hover:text-fg"
            >
              Add
            </button>
          </form>
          {error && <span className="text-[10.5px] text-down">{error}</span>}
          <Spacer />
          <span className="text-[10.5px] text-fg-3">
            {watchlist.length} securities · saved in this browser
          </span>
        </Toolbar>
      }
    >
      {() =>
        watchlist.length === 0 ? (
          <Empty>Your watchlist is empty. Add a ticker above or type WL ADD NVDA.</Empty>
        ) : (
          <QuoteTable
            groups={[
              {
                rows: watchlist.map((w) => ({
                  symbol: w.symbol,
                  name: w.name ?? w.symbol,
                  quote: bySymbol.get(w.symbol) ?? null,
                })),
              },
            ]}
            selected={pane.security}
            latestDate={latest}
            onSelect={(symbol) => selectSecurity(pane.id, symbol)}
            rowAction={(row) => (
              <button
                type="button"
                title={`Remove ${row.symbol}`}
                onClick={(e) => {
                  e.stopPropagation()
                  remove(row.symbol)
                }}
                className="text-fg-4 hover:text-down"
              >
                ×
              </button>
            )}
          />
        )
      }
    </FnFrame>
  )
}
