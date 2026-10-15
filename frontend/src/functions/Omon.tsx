import clsx from 'clsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useOptionChain } from '@/api/client'
import type { OptionChainView, OptionLeg } from '@/api/types'
import { fmtCompact, fmtDate, fmtDateTime, fmtFixed, fmtPct, fmtPrice, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Stat, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

type View = 'quotes' | 'greeks'
const WIDTHS = { '10': 10, '20': 20, ALL: Infinity } as const

// Column sets mirrored around the strike: calls read right-to-left towards it, puts left-to-right.
const COLUMNS: Record<
  View,
  { key: string; label: string; title?: string; fmt: (l: OptionLeg) => string }[]
> = {
  quotes: [
    { key: 'bid', label: 'Bid', fmt: (l) => fmtPrice(l.bid, 2) },
    { key: 'ask', label: 'Ask', fmt: (l) => fmtPrice(l.ask, 2) },
    { key: 'last', label: 'Last', fmt: (l) => fmtPrice(l.last, 2) },
    {
      key: 'iv',
      label: 'IV',
      title: 'Implied volatility (derivlab, Black–Scholes on the parity forward)',
      fmt: (l) => fmtPct(l.iv, 1, false),
    },
    { key: 'vol', label: 'Volume', fmt: (l) => fmtCompact(l.volume, 0) },
    {
      key: 'oi',
      label: 'OI',
      title: 'Open interest (previous close)',
      fmt: (l) => fmtCompact(l.open_interest, 0),
    },
  ],
  greeks: [
    { key: 'iv', label: 'IV', fmt: (l) => fmtPct(l.iv, 1, false) },
    {
      key: 'delta',
      label: 'Δ',
      title: 'Delta: option value change per 1 unit of the underlying',
      fmt: (l) => fmtFixed(l.delta, 3),
    },
    {
      key: 'gamma',
      label: 'Γ',
      title: 'Gamma: delta change per 1 unit of the underlying',
      fmt: (l) => fmtFixed(l.gamma, 4),
    },
    {
      key: 'theta',
      label: 'Θ/day',
      title: 'Theta: value lost per calendar day',
      fmt: (l) => fmtFixed(l.theta_per_day, 3),
    },
    {
      key: 'vega',
      label: 'ν/pt',
      title: 'Vega: value change per 1 volatility point',
      fmt: (l) => fmtFixed(l.vega_per_point, 3),
    },
    {
      key: 'yiv',
      label: 'Yahoo IV',
      title: "Yahoo's own implied vol, for comparison",
      fmt: (l) => fmtPct(l.yahoo_iv, 1, false),
    },
  ],
}

export function Omon({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const view = (pane.params.view ?? 'quotes') as View
  const width = (pane.params.width ?? '10') as keyof typeof WIDTHS
  const query = useOptionChain(pane.security, pane.params.expiry || undefined)
  const chain = query.data?.data

  return (
    <FnFrame
      query={query}
      loadingRows={14}
      toolbar={
        <Toolbar>
          {chain && (
            <select
              value={chain.expiry}
              onChange={(e) => setParams(pane.id, { expiry: e.target.value })}
              aria-label="Expiry"
              className="num h-[22px] rounded-[3px] border border-line bg-canvas px-1.5 text-[11px] text-fg focus:border-amber-dim focus:outline-none"
            >
              {chain.expiries.map((e) => (
                <option key={e} value={e}>
                  {fmtDate(e)}
                </option>
              ))}
            </select>
          )}
          <Seg
            value={view}
            options={[
              { value: 'quotes', label: 'Quotes' },
              { value: 'greeks', label: 'Greeks' },
            ]}
            onChange={(v) => setParams(pane.id, { view: v })}
          />
          <Seg
            value={width}
            options={[
              { value: '10', label: '±10', hint: '10 strikes either side of the forward' },
              { value: '20', label: '±20' },
              { value: 'ALL', label: 'All' },
            ]}
            onChange={(v) => setParams(pane.id, { width: v })}
          />
          <Spacer />
          {chain && (
            <span className="num text-[10.5px] text-fg-3">
              {chain.days}d · r {fmtPct(chain.rate, 2, false)} · P/C vol{' '}
              {fmtFixed(chain.totals.put_call_volume, 2)} · P/C OI{' '}
              {fmtFixed(chain.totals.put_call_open_interest, 2)}
            </span>
          )}
        </Toolbar>
      }
    >
      {(c) => <ChainTable c={c} view={view} width={WIDTHS[width]} />}
    </FnFrame>
  )
}

function ChainTable({ c, view, width }: { c: OptionChainView; view: View; width: number }) {
  const [selected, setSelected] = useState<number | null>(null)
  const atmRef = useRef<HTMLTableRowElement>(null)
  const atmIndex = c.rows.findIndex((r) => r.strike === c.atm_strike)
  const rows = useMemo(
    () =>
      Number.isFinite(width)
        ? c.rows.slice(Math.max(0, atmIndex - width), atmIndex + width + 1)
        : c.rows,
    [c.rows, atmIndex, width],
  )
  const cols = COLUMNS[view]
  const picked = c.rows.find((r) => r.strike === selected) ?? c.rows[atmIndex]

  // Keep the at-the-money strike in view when the chain or expiry changes.
  // Braces matter: Chrome's scrollIntoView returns a Promise, which must not become the cleanup.
  useEffect(() => {
    atmRef.current?.scrollIntoView({ block: 'center' })
  }, [c.expiry, c.symbol])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 gap-x-6 border-b border-line px-3 py-1 @container sm:grid-cols-4">
        <Stat label="Underlying">{fmtPrice(c.spot)}</Stat>
        <Stat label="Forward" title={`From ${c.forward_method}`}>
          {fmtPrice(c.forward)}
        </Stat>
        <Stat label="Call / put volume">
          {fmtCompact(c.totals.call_volume, 1)} / {fmtCompact(c.totals.put_volume, 1)}
        </Stat>
        <Stat label="Call / put OI">
          {fmtCompact(c.totals.call_open_interest, 1)} / {fmtCompact(c.totals.put_open_interest, 1)}
        </Stat>
      </div>
      <div className="pane-scroll min-h-0 flex-1">
        <table className="dt num">
          <thead>
            <tr>
              <th colSpan={cols.length} className="!text-center !text-up/80">
                Calls
              </th>
              <th className="!text-center">{c.currency}</th>
              <th colSpan={cols.length} className="!text-center !text-down/80">
                Puts
              </th>
            </tr>
            <tr>
              {[...cols].reverse().map((col) => (
                <th key={`c${col.key}`} title={col.title} className="!top-[23px]">
                  {col.label}
                </th>
              ))}
              <th className="!top-[23px] !text-center">Strike</th>
              {cols.map((col) => (
                <th key={`p${col.key}`} title={col.title} className="!top-[23px] !text-left">
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const atm = r.strike === c.atm_strike
              return (
                <tr
                  key={r.strike}
                  ref={atm ? atmRef : undefined}
                  onClick={() => setSelected(r.strike)}
                  className={clsx(
                    'cursor-pointer',
                    picked?.strike === r.strike && '[&>td]:!bg-amber/10',
                  )}
                >
                  {[...cols].reverse().map((col) => (
                    <td
                      key={`c${col.key}`}
                      className={clsx(r.call?.in_the_money ? 'bg-up/[0.06] text-fg' : 'text-fg-2')}
                    >
                      {r.call ? col.fmt(r.call) : ''}
                    </td>
                  ))}
                  <td
                    className={clsx('!text-center font-semibold', atm ? 'text-amber' : 'text-fg')}
                  >
                    {fmtPrice(r.strike, 2)}
                  </td>
                  {cols.map((col) => (
                    <td
                      key={`p${col.key}`}
                      className={clsx(
                        '!text-left',
                        r.put?.in_the_money ? 'bg-down/[0.06] text-fg' : 'text-fg-2',
                      )}
                    >
                      {r.put ? col.fmt(r.put) : ''}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {picked && <LegDetail strike={picked.strike} call={picked.call} put={picked.put} />}
    </div>
  )
}

function LegDetail({
  strike,
  call,
  put,
}: {
  strike: number
  call: OptionLeg | null
  put: OptionLeg | null
}) {
  return (
    <div className="grid shrink-0 grid-cols-2 gap-x-6 border-t border-line px-3 py-1.5 text-[10.5px]">
      {(
        [
          ['Call', call],
          ['Put', put],
        ] as const
      ).map(([label, leg]) => (
        <div key={label} className="min-w-0">
          <div className="mb-0.5 flex gap-2">
            <span className={label === 'Call' ? 'text-up' : 'text-down'}>
              {label} {fmtPrice(strike, 2)}
            </span>
            <span className="num truncate text-fg-4">{leg?.contract}</span>
          </div>
          {leg ? (
            <div className="num flex flex-wrap gap-x-3 text-fg-2">
              <span>
                price {fmtPrice(leg.price, 2)}{' '}
                <span className="text-fg-4">({leg.price_source ?? '—'})</span>
              </span>
              <span>IV {fmtPct(leg.iv, 1, false)}</span>
              <span>Δ {fmtFixed(leg.delta, 3)}</span>
              <span>Γ {fmtFixed(leg.gamma, 4)}</span>
              <span>Θ {fmtFixed(leg.theta_per_day, 3)}/d</span>
              <span>ν {fmtFixed(leg.vega_per_point, 3)}/pt</span>
              <span className="text-fg-4">
                last trade {leg.last_trade ? fmtDateTime(leg.last_trade) : '—'}
              </span>
            </div>
          ) : (
            <span className="text-fg-4">not listed</span>
          )}
          {leg && !isNum(leg.iv) && leg.price !== null && (
            <span className="text-fg-4">price outside no-arbitrage bounds — no implied vol</span>
          )}
        </div>
      ))}
    </div>
  )
}
