import clsx from 'clsx'
import { useMemo } from 'react'
import { useFxHistory, useFxMatrix } from '@/api/client'
import type { FxMatrix } from '@/api/types'
import { LineChart } from '@/charts/LineChart'
import { C } from '@/charts/lwc'
import { fmtDate, fmtPct, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Seg, Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

const DEFAULT = 'USD,EUR,GBP,JPY,CHF,CAD,AUD,CNY,TRY'
const RANGES = { '1Y': 1, '2Y': 2, '5Y': 5 } as const

export const fxDecimals = (rate: number) => (rate >= 100 ? 2 : rate >= 10 ? 3 : 4)
const fxFormat = (v: number) => v.toFixed(fxDecimals(v))

export function Fx({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const currencies = useMemo(
    () => (pane.params.currencies ?? DEFAULT).split(','),
    [pane.params.currencies],
  )
  const base = pane.params.base ?? 'EUR'
  const quote = pane.params.quote ?? 'USD'
  const range = (pane.params.range ?? '1Y') as keyof typeof RANGES
  const matrix = useFxMatrix(currencies)
  const history = useFxHistory(base, quote)

  // While a new pair loads the previous one stays on screen, so label from the data itself.
  const shown = history.data?.data
  const lines = useMemo(
    () =>
      shown
        ? [
            {
              id: `${shown.base}${shown.quote}`,
              name: `${shown.base}/${shown.quote}`,
              color: C.amber,
              points: shown.points.map((p) => ({ time: p.date, value: p.rate })),
            },
          ]
        : [],
    [shown],
  )
  const last = history.data?.data.points.at(-1)?.date
  const from = useMemo(() => {
    if (!last) return undefined
    const d = new Date(`${last}T00:00:00Z`)
    d.setUTCFullYear(d.getUTCFullYear() - RANGES[range])
    return d.toISOString().slice(0, 10)
  }, [last, range])

  const pairChange = useMemo(() => {
    const pts = history.data?.data.points
    if (!pts || !from) return null
    const start = pts.find((p) => p.date >= from)
    return start ? pts[pts.length - 1].rate / start.rate - 1 : null
  }, [history.data, from])

  return (
    <FnFrame query={matrix} loadingRows={10}>
      {(m) => (
        <div className="flex h-full min-h-0 flex-col">
          <div className="pane-scroll max-h-[55%] shrink-0 border-b border-line">
            <MatrixTable
              m={m}
              base={base}
              quote={quote}
              onPick={(b, q) => setParams(pane.id, { base: b, quote: q })}
            />
          </div>
          <Toolbar>
            <span className="num text-[12px] font-semibold text-amber">
              {base}/{quote}
            </span>
            <span className="text-[10.5px] text-fg-3">
              units of {quote} per 1 {base}
            </span>
            {history.isPlaceholderData || history.isPending ? (
              <span className="animate-pulse text-[10.5px] text-fg-3">loading…</span>
            ) : history.isError ? (
              <span className="text-[10.5px] text-down">{history.error.message}</span>
            ) : (
              <Delta value={pairChange} className="text-[11px]">
                {fmtPct(pairChange)} {range}
              </Delta>
            )}
            <Spacer />
            <Seg
              value={range}
              options={Object.keys(RANGES) as (keyof typeof RANGES)[]}
              onChange={(v) => setParams(pane.id, { range: v })}
            />
          </Toolbar>
          <div className="min-h-0 flex-1">
            {lines.length > 0 && <LineChart lines={lines} format={fxFormat} visibleFrom={from} />}
          </div>
        </div>
      )}
    </FnFrame>
  )
}

function MatrixTable({
  m,
  base,
  quote,
  onPick,
}: {
  m: FxMatrix
  base: string
  quote: string
  onPick: (base: string, quote: string) => void
}) {
  return (
    <table className="dt num">
      <thead>
        <tr>
          <th title={`ECB fixing ${fmtDate(m.date)}; change vs ${fmtDate(m.previous_date)}`}>
            1 unit ↓ in →
          </th>
          {m.currencies.map((c) => (
            <th key={c} className={clsx(c === quote && '!text-amber')}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {m.currencies.map((b, i) => (
          <tr key={b}>
            <td className={clsx('font-semibold', b === base ? 'text-amber' : 'text-fg-2')}>{b}</td>
            {m.currencies.map((q, j) => {
              const rate = m.rates[i][j]
              const chg = m.change_pct[i][j] / 100
              const picked = b === base && q === quote
              return i === j ? (
                <td key={q} className="text-fg-4">
                  —
                </td>
              ) : (
                <td
                  key={q}
                  onClick={() => onPick(b, q)}
                  title={`${b}/${q} ${fxFormat(rate)} (${fmtPct(chg)} d/d)`}
                  className={clsx('cursor-pointer', picked && '!bg-amber/15')}
                >
                  <div className="text-fg">{isNum(rate) ? fxFormat(rate) : '—'}</div>
                  <Delta value={chg} className="text-[9.5px]">
                    {fmtPct(chg)}
                  </Delta>
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
