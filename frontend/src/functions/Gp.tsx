import { useMemo } from 'react'
import { useHistory } from '@/api/client'
import type { Span } from '@/api/types'
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

  const query = useHistory(pane.security, spanFor(range))
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
          <Spacer />
          {[20, 50, 200].map((n) => (
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
          <Toggle
            on={log}
            onChange={(v) => setParams(pane.id, { log: v ? '1' : '0' })}
            title="Logarithmic price scale"
          >
            LOG
          </Toggle>
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
      {(h) => (
        <PriceChart
          history={h}
          style={style}
          log={log}
          adjusted={adjusted}
          averages={averages}
          visibleFrom={visibleFrom(range, lastDate)}
        />
      )}
    </FnFrame>
  )
}
