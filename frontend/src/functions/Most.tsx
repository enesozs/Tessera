import clsx from 'clsx'
import { useMovers } from '@/api/client'
import type { MoverKind } from '@/api/types'
import { fmtCompact, fmtFixed, fmtPct, fmtPrice, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Seg, Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

export function Most({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const kind = (pane.params.kind ?? 'gainers') as MoverKind
  const query = useMovers(kind)

  return (
    <FnFrame
      query={query}
      loadingRows={14}
      toolbar={
        <Toolbar>
          <Seg
            value={kind}
            options={[
              { value: 'gainers', label: 'Gainers' },
              { value: 'losers', label: 'Losers' },
              { value: 'actives', label: 'Most active' },
            ]}
            onChange={(v) => setParams(pane.id, { kind: v })}
          />
          <Spacer />
          <span className="text-[10.5px] text-fg-3">
            U.S. equities · click to drive linked panes
          </span>
        </Toolbar>
      }
    >
      {(rows) => (
        <div className="pane-scroll h-full @container">
          <table className="dt">
            <thead>
              <tr>
                <th>Name</th>
                <th>Last</th>
                <th>Chg %</th>
                <th>Volume</th>
                <th title="Today's volume ÷ 3-month average daily volume">Rel vol</th>
                <th className="hidden @lg:table-cell">Mkt cap</th>
                <th className="hidden @xl:table-cell">Exchange</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const rel =
                  isNum(m.volume) && isNum(m.avg_volume_3m) && m.avg_volume_3m > 0
                    ? m.volume / m.avg_volume_3m
                    : null
                return (
                  <tr
                    key={m.symbol}
                    onClick={() => selectSecurity(pane.id, m.symbol)}
                    className={clsx(
                      'cursor-pointer',
                      pane.security === m.symbol && '[&>td]:!bg-amber/10',
                    )}
                  >
                    <td className="max-w-0 min-w-40 truncate">
                      <span className={pane.security === m.symbol ? 'text-amber' : 'text-fg'}>
                        {m.name}
                      </span>
                      <span className="num ml-2 text-[10.5px] text-fg-3">{m.symbol}</span>
                    </td>
                    <td className="num text-fg">{fmtPrice(m.price)}</td>
                    <td className="num">
                      <Delta value={m.change_pct}>{fmtPct(m.change_pct)}</Delta>
                    </td>
                    <td className="num text-fg-2">{fmtCompact(m.volume, 1)}</td>
                    <td
                      className={clsx('num', isNum(rel) && rel >= 2 ? 'text-amber' : 'text-fg-2')}
                    >
                      {isNum(rel) ? `${fmtFixed(rel, 1)}×` : '—'}
                    </td>
                    <td className="num hidden text-fg-2 @lg:table-cell">
                      {fmtCompact(m.market_cap, 1)}
                    </td>
                    <td className="hidden text-fg-3 @xl:table-cell">{m.exchange}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </FnFrame>
  )
}
