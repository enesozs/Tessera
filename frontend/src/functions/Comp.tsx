import clsx from 'clsx'
import { useState } from 'react'
import { useComps } from '@/api/client'
import type { CompMetric, CompRow, Comps } from '@/api/types'
import { isTicker } from '@/lib/command'
import { fmtCompact, fmtFixed, fmtPct, isNum, toneClass } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

type Kind = 'multiple' | 'pct' | 'usd' | 'num'

const COLUMNS: {
  key: CompMetric
  label: string
  kind: Kind
  title: string
  higherIsCheap?: boolean
}[] = [
  {
    key: 'market_cap_usd',
    label: 'Mkt cap $',
    kind: 'usd',
    title: 'Market capitalisation, USD at ECB reference rates',
  },
  { key: 'trailing_pe', label: 'P/E', kind: 'multiple', title: 'Price / trailing 12-month EPS' },
  {
    key: 'forward_pe',
    label: 'Fwd P/E',
    kind: 'multiple',
    title: 'Price / next fiscal year consensus EPS',
  },
  {
    key: 'ev_to_ebitda',
    label: 'EV/EBITDA',
    kind: 'multiple',
    title: 'Enterprise value / trailing EBITDA',
  },
  {
    key: 'ev_to_revenue',
    label: 'EV/Sales',
    kind: 'multiple',
    title: 'Enterprise value / trailing revenue',
  },
  { key: 'price_to_book', label: 'P/B', kind: 'multiple', title: 'Price / book value per share' },
  { key: 'dividend_yield', label: 'Div yld', kind: 'pct', title: 'Forward dividend yield' },
  { key: 'gross_margin', label: 'Gross m', kind: 'pct', title: 'Gross margin (ttm)' },
  { key: 'operating_margin', label: 'Op m', kind: 'pct', title: 'Operating margin (ttm)' },
  { key: 'profit_margin', label: 'Net m', kind: 'pct', title: 'Net margin (ttm)' },
  { key: 'return_on_equity', label: 'ROE', kind: 'pct', title: 'Return on equity (ttm)' },
  {
    key: 'revenue_growth',
    label: 'Rev g',
    kind: 'pct',
    title: 'Revenue growth, latest quarter y/y',
  },
  { key: 'beta', label: 'Beta', kind: 'num', title: '5-year monthly beta vs the local index' },
]

function fmt(kind: Kind, v: number | null | undefined) {
  if (!isNum(v)) return '—'
  if (kind === 'multiple') return v > 0 ? `${fmtFixed(v, v >= 100 ? 0 : 1)}×` : 'neg'
  if (kind === 'pct') return fmtPct(v, 1, false)
  if (kind === 'usd') return fmtCompact(v, 1)
  return fmtFixed(v, 2)
}

/** Target vs peer median: relative premium for multiples, percentage-point gap for ratios. */
function premium(kind: Kind, target: number | null, median: number | null) {
  if (!isNum(target) || !isNum(median)) return { text: '—', value: null }
  if (kind === 'multiple' || kind === 'usd' || kind === 'num') {
    if (median <= 0 || (kind === 'multiple' && target <= 0)) return { text: '—', value: null }
    const p = target / median - 1
    return { text: fmtPct(p, 0), value: p }
  }
  const d = (target - median) * 100
  return { text: `${d > 0 ? '+' : d < 0 ? '−' : ''}${Math.abs(d).toFixed(1)}pp`, value: d }
}

export function Comp({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const peers = pane.params.peers ?? ''
  const query = useComps(pane.security, peers)
  const [draft, setDraft] = useState<string | null>(null)
  const current =
    query.data?.data.rows
      .slice(1)
      .map((r) => r.symbol)
      .join(' ') ?? ''

  const apply = () => {
    if (draft === null) return
    const list = draft
      .toUpperCase()
      .split(/[\s,]+/)
      .filter(isTicker)
    setParams(pane.id, { peers: list.join(',') })
    setDraft(null)
  }

  return (
    <FnFrame
      query={query}
      loadingRows={10}
      toolbar={
        <Toolbar>
          <span className="text-[10.5px] text-fg-3">Peers</span>
          <input
            value={draft ?? current}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={apply}
            onKeyDown={(e) => e.key === 'Enter' && apply()}
            placeholder="TSLA GM F …"
            aria-label="Peer tickers"
            className="num h-[22px] min-w-0 flex-1 rounded-[3px] border border-line bg-canvas px-2 text-[11px] text-fg uppercase focus:border-amber-dim focus:outline-none"
          />
          {peers && (
            <button
              type="button"
              onClick={() => setParams(pane.id, { peers: '' })}
              className="h-[22px] rounded-[3px] border border-line px-2 text-[10.5px] text-fg-2 hover:text-amber"
            >
              Industry peers
            </button>
          )}
          <Spacer />
          {query.data && (
            <span className="text-[10.5px] text-fg-3">
              {query.data.data.peers_source === 'industry'
                ? `Largest U.S.-listed · ${query.data.data.industry ?? 'industry'}`
                : 'Custom peer set'}
            </span>
          )}
        </Toolbar>
      }
    >
      {(c) => <CompTable c={c} />}
    </FnFrame>
  )
}

function CompTable({ c }: { c: Comps }) {
  const target = c.rows[0]
  return (
    <div className="pane-scroll h-full">
      <table className="dt num">
        <thead>
          <tr>
            <th className="sticky left-0 z-[2] min-w-48 bg-surface">Company</th>
            {COLUMNS.map((col) => (
              <th key={col.key} title={col.title}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {c.rows.map((r) => (
            <Row key={r.symbol} r={r} />
          ))}
          <tr className="[&>td]:border-t [&>td]:border-line-strong">
            <td className="sticky left-0 z-[1] bg-surface font-sans font-semibold text-fg-2">
              Peer median
            </td>
            {COLUMNS.map((col) => (
              <td key={col.key} className="font-semibold text-fg-2">
                {fmt(col.kind, c.median[col.key])}
              </td>
            ))}
          </tr>
          <tr>
            <td className="sticky left-0 z-[1] bg-surface font-sans text-amber">
              {target.symbol} vs median
            </td>
            {COLUMNS.map((col) => {
              const p = premium(col.kind, target[col.key], c.median[col.key])
              const cls =
                p.value === null || col.kind === 'usd' || col.kind === 'num'
                  ? 'text-fg-2'
                  : col.kind === 'multiple'
                    ? p.value > 0
                      ? 'text-down/90'
                      : 'text-up'
                    : toneClass[p.value > 0 ? 'up' : p.value < 0 ? 'down' : 'flat']
              return (
                <td
                  key={col.key}
                  className={cls}
                  title={
                    col.kind === 'multiple'
                      ? 'A premium multiple means the market pays more per unit of earnings/sales'
                      : undefined
                  }
                >
                  {p.text}
                </td>
              )
            })}
          </tr>
        </tbody>
      </table>
      <p className="px-3 py-2 text-[10.5px] text-fg-4">
        Premium multiples are shaded red and discounts green (cheaper per unit of earnings); for
        margins and returns, higher is green. "neg" marks a negative multiple, which is excluded
        from medians.
      </p>
    </div>
  )
}

function Row({ r }: { r: CompRow }) {
  return (
    <tr className={clsx(r.is_target && '[&>td]:!bg-amber/10')}>
      <td className="sticky left-0 z-[1] max-w-64 truncate bg-surface font-sans">
        <span className={r.is_target ? 'text-amber' : 'text-fg'}>{r.name}</span>
        <span className="num ml-2 text-[10.5px] text-fg-3">{r.symbol}</span>
        {r.country && <span className="ml-1.5 text-[10px] text-fg-4">{r.country}</span>}
      </td>
      {r.error ? (
        <td colSpan={COLUMNS.length} className="!text-left text-down/80">
          {r.error}
        </td>
      ) : (
        COLUMNS.map((col) => (
          <td key={col.key} className={r.is_target ? 'text-fg' : 'text-fg-2'}>
            {fmt(col.kind, r[col.key])}
          </td>
        ))
      )}
    </tr>
  )
}
