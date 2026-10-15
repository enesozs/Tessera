import clsx from 'clsx'
import type { ReactNode } from 'react'
import type { Quote } from '@/api/types'
import { fmtDate, fmtPct, fmtPrice, fmtSigned, isNum } from '@/lib/format'
import { Delta, Spark } from '@/ui/primitives'

export interface QuoteRow {
  symbol: string
  name: string
  tag?: string
  quote: Quote | null
}

/** Background tint proportional to the day's move — a heatmap folded into the table. */
function heat(pct: number | null): string | undefined {
  if (!isNum(pct)) return undefined
  const strength = Math.min(1, Math.abs(pct) / 0.03) * 0.28
  const rgb = pct >= 0 ? '46,194,126' : '255,93,93'
  return `rgba(${rgb},${strength.toFixed(3)})`
}

export function QuoteTable({
  groups,
  selected,
  onSelect,
  rowAction,
  latestDate,
}: {
  groups: { name?: string; rows: QuoteRow[] }[]
  selected?: string
  onSelect: (symbol: string) => void
  rowAction?: (row: QuoteRow) => ReactNode
  /** Rows older than this date are flagged (market closed / holiday). */
  latestDate?: string
}) {
  const cols = 8 + (rowAction ? 1 : 0)
  return (
    <div className="pane-scroll h-full @container">
      <table className="dt">
        <thead>
          <tr>
            <th>Name</th>
            <th>Last</th>
            <th>Chg</th>
            <th>Chg %</th>
            <th className="hidden @lg:table-cell">1M %</th>
            <th>YTD %</th>
            <th className="hidden @md:table-cell">30D</th>
            <th className="hidden @xl:table-cell">Date</th>
            {rowAction && <th />}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <GroupRows key={g.name ?? 'all'} name={g.name} cols={cols}>
              {g.rows.map((r) => {
                const q = r.quote
                const old = q && latestDate && q.as_of < latestDate
                return (
                  <tr
                    key={r.symbol}
                    onClick={() => onSelect(r.symbol)}
                    className={clsx(
                      'cursor-pointer',
                      selected === r.symbol && '[&>td]:!bg-amber/10',
                    )}
                  >
                    <td className="max-w-0 min-w-36 truncate">
                      <span className={clsx(selected === r.symbol ? 'text-amber' : 'text-fg')}>
                        {r.name}
                      </span>
                      <span className="num ml-2 text-[10.5px] text-fg-3">{r.symbol}</span>
                      {r.tag && <span className="ml-1.5 text-[10px] text-fg-4">{r.tag}</span>}
                    </td>
                    <td className="num text-fg">
                      {q ? fmtPrice(q.last) : <span className="text-fg-4">n/a</span>}
                    </td>
                    <td>
                      <Delta value={q?.change}>
                        {fmtSigned(q?.change, Math.abs(q?.last ?? 0) < 10 ? 3 : 2)}
                      </Delta>
                    </td>
                    <td style={{ background: heat(q?.change_pct ?? null) }}>
                      <Delta value={q?.change_pct}>{fmtPct(q?.change_pct)}</Delta>
                    </td>
                    <td className="hidden @lg:table-cell">
                      <Delta value={q?.change_1m_pct}>{fmtPct(q?.change_1m_pct, 1)}</Delta>
                    </td>
                    <td>
                      <Delta value={q?.change_ytd_pct}>{fmtPct(q?.change_ytd_pct, 1)}</Delta>
                    </td>
                    <td className="hidden w-20 @md:table-cell">
                      {q && <Spark values={q.spark} width={64} height={14} />}
                    </td>
                    <td
                      className={clsx(
                        'num hidden text-[10.5px] @xl:table-cell',
                        old ? 'text-amber/80' : 'text-fg-3',
                      )}
                      title={
                        old
                          ? 'Older than the latest session in this table (market closed?)'
                          : undefined
                      }
                    >
                      {q ? fmtDate(q.as_of) : '—'}
                    </td>
                    {rowAction && <td className="w-6">{rowAction(r)}</td>}
                  </tr>
                )
              })}
            </GroupRows>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function GroupRows({ name, cols, children }: { name?: string; cols: number; children: ReactNode }) {
  return (
    <>
      {name && (
        <tr className="group">
          <td colSpan={cols}>{name}</td>
        </tr>
      )}
      {children}
    </>
  )
}
