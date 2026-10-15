import { useMemo, useState } from 'react'
import { useHistories, useHistory } from '@/api/client'
import type { History, Span } from '@/api/types'
import { CompareChart, type CompareLine } from '@/charts/CompareChart'
import { PALETTE } from '@/charts/lwc'
import type { Time } from 'lightweight-charts'
import { isTicker } from '@/lib/command'
import { PriceChart, SMA_COLORS, type ChartStyle } from '@/charts/PriceChart'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Toggle, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const RANGES = ['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '2Y', '5Y', '10Y', 'MAX'] as const
type Range = (typeof RANGES)[number]

// Daily ranges share one 10-year download and only move the visible window, so switching
// range is instant and moving averages are warmed up from the start of the view.
function spanFor(range: Range): Span {
  if (range === '1D') return 'intraday1d'
  if (range === '5D') return 'intraday5d'
  if (range === 'MAX') return 'weekly'
  return 'daily'
}

function visibleFrom(range: Range, lastDate: string | undefined): string | undefined {
  if (!lastDate || range === '10Y' || spanFor(range) !== 'daily') return undefined
  const d = new Date(`${lastDate}T00:00:00Z`)
  if (range === 'YTD') return `${d.getUTCFullYear()}-01-01`
  const months: Partial<Record<Range, number>> = {
    '1M': 1,
    '3M': 3,
    '6M': 6,
    '1Y': 12,
    '2Y': 24,
    '5Y': 60,
  }
  d.setUTCMonth(d.getUTCMonth() - (months[range] ?? 12))
  return d.toISOString().slice(0, 10)
}

export function Gp({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const p = pane.params
  const range = (RANGES.includes(p.range as Range) ? p.range : '1Y') as Range
  const style = (p.style ?? 'candles') as ChartStyle
  const log = p.log === '1'
  const adjusted = p.adj === '1'
  const averages = useMemo(
    () => (p.sma ?? '50,200').split(',').filter(Boolean).map(Number),
    [p.sma],
  )

  const compare = useMemo(() => (p.cmp ?? '').split(',').filter(Boolean), [p.cmp])
  const query = useHistory(pane.security, spanFor(range))
  const others = useHistories(compare, spanFor(range))
  const history = query.data?.data
  const lastDate =
    history && typeof history.bars.at(-1)?.time === 'string'
      ? (history.bars.at(-1)!.time as string)
      : undefined

  const toggleSma = (n: number) => {
    const next = averages.includes(n)
      ? averages.filter((a) => a !== n)
      : [...averages, n].sort((a, b) => a - b)
    setParams(pane.id, { sma: next.join(',') })
  }

  const comparing = compare.length > 0
  const otherData = others.map((o) => o.data?.data)
  const loaded = others.map((o) => `${o.data?.data.symbol}:${o.dataUpdatedAt}`).join(',')
  const lines = useMemo<CompareLine[]>(() => {
    if (!comparing || !history) return []
    const toLine = (h: History, i: number): CompareLine => ({
      symbol: h.symbol,
      color: PALETTE[i % PALETTE.length],
      // Raw UTC times: exchanges in different zones must share one time axis.
      points: h.bars.map((b) => ({
        time: b.time as Time,
        value: adjusted && b.adj_close ? b.adj_close : b.close,
      })),
    })
    return [history, ...otherData.filter((h): h is History => !!h)].map(toLine)
    // otherData is a new array every render; `loaded` changes exactly when its contents do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comparing, history, adjusted, loaded])
  const failed = compare.filter((_, i) => others[i]?.isError)

  const setCompare = (list: string[]) => setParams(pane.id, { cmp: list.slice(0, 5).join(',') })

  return (
    <FnFrame
      query={query}
      loadingRows={4}
      toolbar={
        <Toolbar>
          <Seg value={range} options={RANGES} onChange={(v) => setParams(pane.id, { range: v })} />
          <Seg
            value={style}
            options={[
              { value: 'candles', label: 'Candle' },
              { value: 'line', label: 'Line' },
              { value: 'area', label: 'Area' },
            ]}
            onChange={(v) => setParams(pane.id, { style: v })}
          />
          <CompareInput compare={compare} failed={failed} onChange={setCompare} />
          <Spacer />
          {!comparing &&
            [20, 50, 200].map((n) => (
              <Toggle
                key={n}
                on={averages.includes(n)}
                onChange={() => toggleSma(n)}
                color={SMA_COLORS[n]}
                title={`${n}-period simple moving average`}
              >
                SMA{n}
              </Toggle>
            ))}
          {!comparing && (
            <Toggle
              on={log}
              onChange={(v) => setParams(pane.id, { log: v ? '1' : '0' })}
              title="Logarithmic price scale"
            >
              LOG
            </Toggle>
          )}
          <Toggle
            on={adjusted}
            onChange={(v) => setParams(pane.id, { adj: v ? '1' : '0' })}
            title="Adjust for dividends (total-return view). Prices are always split-adjusted."
          >
            ADJ
          </Toggle>
        </Toolbar>
      }
      footerExtra={
        history && (
          <>
            <span className="text-fg-4">·</span>
            <span className="num">
              {history.interval} bars{history.currency ? ` · ${history.currency}` : ''}
              {adjusted ? ' · dividend-adjusted' : ''}
            </span>
          </>
        )
      }
    >
      {(h) =>
        comparing ? (
          <CompareChart
            lines={lines}
            intraday={h.span.startsWith('intraday')}
            visibleFrom={visibleFrom(range, lastDate)}
          />
        ) : (
          <PriceChart
            history={h}
            style={style}
            log={log}
            adjusted={adjusted}
            averages={averages}
            visibleFrom={visibleFrom(range, lastDate)}
          />
        )
      }
    </FnFrame>
  )
}

function CompareInput({
  compare,
  failed,
  onChange,
}: {
  compare: string[]
  failed: string[]
  onChange: (list: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const extra = draft
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(isTicker)
    if (extra.length) onChange([...new Set([...compare, ...extra])])
    setDraft('')
  }
  return (
    <div className="flex items-center gap-1">
      {compare.map((s, i) => (
        <span
          key={s}
          className="flex h-[22px] items-center gap-1 rounded-[3px] border border-line px-1.5 text-[10.5px]"
          title={failed.includes(s) ? 'No data for this ticker' : undefined}
        >
          <span
            className="size-1.5 rounded-full"
            style={{ background: PALETTE[(i + 1) % PALETTE.length] }}
          />
          <span className={failed.includes(s) ? 'num text-down line-through' : 'num text-fg-2'}>
            {s}
          </span>
          <button
            type="button"
            onClick={() => onChange(compare.filter((c) => c !== s))}
            className="text-fg-4 hover:text-down"
          >
            ×
          </button>
        </span>
      ))}
      {compare.length < 5 && (
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
          onBlur={add}
          placeholder="+ VS"
          aria-label="Compare with"
          className="num h-[22px] w-16 rounded-[3px] border border-line bg-canvas px-1.5 text-[10.5px] text-fg uppercase placeholder:text-fg-4 focus:w-28 focus:border-amber-dim focus:outline-none"
        />
      )}
    </div>
  )
}
