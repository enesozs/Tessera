import { useMemo, useState } from 'react'
import { useHistory } from '@/api/client'
import type { Bar } from '@/api/types'
import { fmtCompact, fmtDate, fmtPct, fmtPrice, isNum } from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Seg, Spacer, Stat, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const WINDOWS = { '1M': 21, '3M': 63, '6M': 126, '1Y': 252, '5Y': 1260 } as const
type Window = keyof typeof WINDOWS

/** Range statistics over a window of daily bars (oldest first). */
export function rangeStats(bars: Bar[]) {
  const closes = bars.map((b) => b.close)
  const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]))
  const mean = returns.reduce((a, b) => a + b, 0) / (returns.length || 1)
  const variance =
    returns.reduce((a, r) => a + (r - mean) ** 2, 0) / Math.max(1, returns.length - 1)
  let peak = -Infinity
  let maxDrawdown = 0
  for (const c of closes) {
    peak = Math.max(peak, c)
    maxDrawdown = Math.min(maxDrawdown, c / peak - 1)
  }
  return {
    change: closes.length > 1 ? closes[closes.length - 1] / closes[0] - 1 : null,
    high: Math.max(...bars.map((b) => b.high)),
    low: Math.min(...bars.map((b) => b.low)),
    avgVolume: bars.reduce((a, b) => a + b.volume, 0) / (bars.length || 1),
    // Annualised close-to-close volatility from daily log returns (252 trading days).
    volatility: returns.length > 1 ? Math.sqrt(variance * 252) : null,
    maxDrawdown,
  }
}

export function Hp({ pane }: FnProps) {
  const query = useHistory(pane.security, 'daily')
  const [lookback, setLookback] = useState<Window>('3M')

  return (
    <FnFrame
      query={query}
      toolbar={
        <Toolbar>
          <Seg value={lookback} options={Object.keys(WINDOWS) as Window[]} onChange={setLookback} />
          <Spacer />
          <span className="text-[10.5px] text-fg-3">Daily bars · newest first</span>
        </Toolbar>
      }
    >
      {(h) => <HpTable bars={h.bars} window={WINDOWS[lookback]} currency={h.currency} />}
    </FnFrame>
  )
}

function HpTable({
  bars,
  window,
  currency,
}: {
  bars: Bar[]
  window: number
  currency: string | null
}) {
  const slice = useMemo(() => bars.slice(-window - 1), [bars, window])
  const stats = useMemo(() => rangeStats(slice), [slice])
  const rows = useMemo(
    () =>
      slice
        .slice(1)
        .map((b, i) => ({ ...b, ret: b.close / slice[i].close - 1 }))
        .reverse(),
    [slice],
  )

  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <div className="grid shrink-0 grid-cols-2 gap-x-6 border-b border-line px-3 py-2 @lg:grid-cols-3">
        <Stat label="Period return">
          <Delta value={stats.change}>{fmtPct(stats.change)}</Delta>
        </Stat>
        <Stat label="High / low">
          {fmtPrice(stats.high)} / {fmtPrice(stats.low)}
        </Stat>
        <Stat
          label="Realised vol (ann.)"
          title="Annualised standard deviation of daily log returns"
        >
          {fmtPct(stats.volatility, 1, false)}
        </Stat>
        <Stat label="Max drawdown">
          <Delta value={stats.maxDrawdown}>{fmtPct(stats.maxDrawdown, 1)}</Delta>
        </Stat>
        <Stat label="Avg volume">{fmtCompact(stats.avgVolume, 2)}</Stat>
        <Stat label="Currency">{currency ?? '—'}</Stat>
      </div>
      <div className="pane-scroll min-h-0 flex-1">
        <table className="dt num">
          <thead>
            <tr>
              <th>Date</th>
              <th>Open</th>
              <th>High</th>
              <th>Low</th>
              <th>Close</th>
              <th title="Close adjusted for dividends and splits">Adj close</th>
              <th>Change</th>
              <th>Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={String(b.time)}>
                <td className="text-fg-2">{fmtDate(String(b.time))}</td>
                <td>{fmtPrice(b.open)}</td>
                <td>{fmtPrice(b.high)}</td>
                <td>{fmtPrice(b.low)}</td>
                <td className="text-fg">{fmtPrice(b.close)}</td>
                <td className="text-fg-3">{isNum(b.adj_close) ? fmtPrice(b.adj_close) : '—'}</td>
                <td>
                  <Delta value={b.ret}>{fmtPct(b.ret)}</Delta>
                </td>
                <td className="text-fg-2">{fmtCompact(b.volume, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
