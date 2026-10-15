import clsx from 'clsx'
import { useEffect, useState } from 'react'
import { useScreen, useScreenFields } from '@/api/client'
import { fmtCompact, fmtFixed, fmtPct, fmtPrice } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Empty, SectionTitle, Toggle } from '@/ui/primitives'
import type { FnProps } from './types'

export const SCREEN_EXAMPLES = [
  'COUNTRY = IT AND ROE > 15% SORT BY MKTCAP DESC',
  'COUNTRY = US AND SECTOR = TECH AND PE BETWEEN 10 AND 25 AND REV_GROWTH > 15%',
  'COUNTRY IN (DE, FR, NL) AND DIVYIELD > 4% AND NETDEBT_EBITDA < 2 SORT BY DIVYIELD DESC',
  'COUNTRY = US AND MKTCAP > 10B AND PERF52W < -30% SORT BY PERF52W ASC',
  'COUNTRY = TR AND PB < 1 AND ROE > 20% LIMIT 25',
]

export function Eqs({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const q = pane.params.q ?? ''
  const [draft, setDraft] = useState(q || SCREEN_EXAMPLES[0])
  const [showFields, setShowFields] = useState(false)
  useEffect(() => {
    if (q) setDraft(q)
  }, [q])
  const query = useScreen(q)
  const run = (text = draft) => setParams(pane.id, { q: text.trim() })

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-line px-2 py-1.5">
        <div className="flex items-start gap-1.5">
          <span className="num pt-1 text-[11px] font-semibold text-amber">FIND EQUITIES WHERE</span>
          <textarea
            value={draft}
            rows={2}
            spellCheck={false}
            aria-label="Screen query"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                run()
              }
            }}
            className="num min-w-0 flex-1 resize-none rounded-[3px] border border-line bg-canvas px-2 py-1 text-[11.5px] text-fg uppercase focus:border-amber-dim focus:outline-none"
          />
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={() => run()}
              className="h-[22px] rounded-[3px] border border-amber-dim bg-amber/10 px-3 text-[11px] text-amber hover:bg-amber/20"
            >
              Run ⏎
            </button>
            <Toggle on={showFields} onChange={setShowFields}>
              Fields
            </Toggle>
          </div>
        </div>
        <div className="mt-1 flex flex-wrap gap-1">
          {SCREEN_EXAMPLES.map((e) => (
            <button
              key={e}
              type="button"
              onClick={() => {
                setDraft(e)
                run(e)
              }}
              className="num max-w-full truncate rounded-[2px] border border-line px-1.5 text-[10px] text-fg-3 hover:border-amber-dim hover:text-amber"
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      {showFields && <FieldReference />}
      <div className="min-h-0 flex-1">
        {!q ? (
          <Empty>Write a condition and press Enter — e.g. COUNTRY = IT AND ROE &gt; 15%</Empty>
        ) : (
          <FnFrame query={query} loadingRows={12}>
            {(r) => (
              <div className="pane-scroll h-full @container">
                <div className="flex flex-wrap items-baseline gap-x-3 border-b border-line px-3 py-1 text-[10.5px]">
                  <span className="num text-fg-2">{r.query}</span>
                  <span className="text-fg-3">
                    {r.total.toLocaleString('en-US')} matches · showing {r.rows.length} · sorted by{' '}
                    {r.sort}
                  </span>
                </div>
                {r.warnings.map((w) => (
                  <div
                    key={w}
                    className="border-b border-line bg-amber/5 px-3 py-1 text-[10.5px] text-amber/90"
                  >
                    ⚠ {w}
                  </div>
                ))}
                <table className="dt num">
                  <thead>
                    <tr>
                      <th>Company</th>
                      <th>Last</th>
                      <th>Chg %</th>
                      <th>Mkt cap</th>
                      <th>P/E</th>
                      <th className="hidden @lg:table-cell">Fwd P/E</th>
                      <th className="hidden @lg:table-cell">P/B</th>
                      <th>Div yld</th>
                      <th className="hidden @md:table-cell">52W</th>
                      <th className="hidden @xl:table-cell">Exchange</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((x) => (
                      <tr
                        key={x.symbol}
                        onClick={() => selectSecurity(pane.id, x.symbol)}
                        className={clsx(
                          'cursor-pointer',
                          pane.security === x.symbol && '[&>td]:!bg-amber/10',
                        )}
                      >
                        <td className="max-w-0 min-w-44 truncate font-sans">
                          <span className={pane.security === x.symbol ? 'text-amber' : 'text-fg'}>
                            {x.name}
                          </span>
                          <span className="num ml-2 text-[10.5px] text-fg-3">{x.symbol}</span>
                        </td>
                        <td className="text-fg">
                          {fmtPrice(x.price)}{' '}
                          <span className="text-[9.5px] text-fg-4">{x.currency}</span>
                        </td>
                        <td>
                          <Delta value={x.change_pct}>{fmtPct(x.change_pct)}</Delta>
                        </td>
                        <td className="text-fg-2">{fmtCompact(x.market_cap, 1)}</td>
                        <td className="text-fg-2">{fmtFixed(x.trailing_pe, 1)}</td>
                        <td className="hidden text-fg-2 @lg:table-cell">
                          {fmtFixed(x.forward_pe, 1)}
                        </td>
                        <td className="hidden text-fg-2 @lg:table-cell">
                          {fmtFixed(x.price_to_book, 2)}
                        </td>
                        <td className="text-fg-2">{fmtPct(x.dividend_yield, 2, false)}</td>
                        <td className="hidden @md:table-cell">
                          <Delta value={x.perf_52w}>{fmtPct(x.perf_52w, 0)}</Delta>
                        </td>
                        <td className="hidden font-sans text-fg-3 @xl:table-cell">{x.exchange}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </FnFrame>
        )}
      </div>
    </div>
  )
}

function FieldReference() {
  const { data } = useScreenFields()
  if (!data) return null
  const groups = [...new Set(data.map((f) => f.group))]
  return (
    <div className="pane-scroll max-h-[40%] shrink-0 border-b border-line px-3 py-1 @container">
      <div className="grid gap-x-6 @2xl:grid-cols-3">
        {groups.map((g) => (
          <div key={g}>
            <SectionTitle>{g}</SectionTitle>
            {data
              .filter((f) => f.group === g)
              .map((f) => (
                <div key={f.name} className="flex justify-between gap-2 text-[10.5px]">
                  <span className="num text-fg">{f.name}</span>
                  <span className="truncate text-fg-3">
                    {f.label}
                    {f.kind === 'percent' ? ' (%)' : f.kind === 'money' ? ' (2B, 500M)' : ''}
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
      <p className="py-1 text-[10px] text-fg-4">
        Operators: = &gt; &lt; &gt;= &lt;= BETWEEN a AND b · IN (a, b) · combine with AND / OR and
        parentheses · SORT BY field ASC|DESC · LIMIT n (max 250).
      </p>
    </div>
  )
}
