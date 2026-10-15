import { useState } from 'react'
import { useProfile } from '@/api/client'
import type { Profile } from '@/api/types'
import {
  fmtCompact,
  fmtDateTime,
  fmtFixed,
  fmtMultiple,
  fmtPct,
  fmtPrice,
  fmtSigned,
  isNum,
} from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, RangeBar, SectionTitle, Stat } from '@/ui/primitives'
import type { FnProps } from './types'

export function Des({ pane }: FnProps) {
  const query = useProfile(pane.security)
  return (
    <FnFrame query={query} loadingRows={12}>
      {(p) => <Profile p={p} />}
    </FnFrame>
  )
}

const pct = (v: number | null) => fmtPct(v, 1, false)

function Profile({ p }: { p: Profile }) {
  const [expanded, setExpanded] = useState(false)
  const ccy = p.currency ?? ''
  const fin = p.financial_currency ?? ccy
  const money = (v: number | null, c = ccy) => (isNum(v) ? `${fmtCompact(v)} ${c}` : '—')

  return (
    <div className="pane-scroll h-full @container">
      <div className="border-b border-line px-3 py-2.5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-[15px] font-semibold text-fg">{p.name}</h2>
          <span className="num text-amber">{p.symbol}</span>
          <span className="text-fg-3">
            {[p.exchange, p.quote_type, p.country].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="mt-1.5 flex flex-wrap items-baseline gap-x-3">
          <span className="num text-[22px] leading-none font-medium text-fg">
            {fmtPrice(p.price)}
          </span>
          <span className="text-fg-3">{ccy}</span>
          <Delta value={p.change} className="text-[13px]">
            {fmtSigned(p.change)} ({fmtPct(p.change_pct)})
          </Delta>
          <span className="text-[10.5px] text-fg-3">
            {p.market_state && (
              <span className="mr-1.5 tracking-wide uppercase">{p.market_state.toLowerCase()}</span>
            )}
            {fmtDateTime(p.market_time, p.timezone ?? undefined)}
          </span>
        </div>
        {(p.sector || p.industry) && (
          <div className="mt-1 text-fg-2">{[p.sector, p.industry].filter(Boolean).join(' › ')}</div>
        )}
      </div>

      <div className="grid gap-x-6 px-3 py-2 @xl:grid-cols-2 @4xl:grid-cols-3">
        <div>
          <SectionTitle>Trading</SectionTitle>
          <Stat label="Open">{fmtPrice(p.open)}</Stat>
          <Stat label="Day range">
            {fmtPrice(p.day_low)} – {fmtPrice(p.day_high)}
          </Stat>
          <Stat label="Previous close">{fmtPrice(p.previous_close)}</Stat>
          <Stat label="Volume / 3M avg">
            {fmtCompact(p.volume, 1)} / {fmtCompact(p.avg_volume_3m, 1)}
          </Stat>
          <Stat label="52-week range">
            {fmtPrice(p.low_52w)} – {fmtPrice(p.high_52w)}
          </Stat>
          <div className="py-2">
            <RangeBar low={p.low_52w} high={p.high_52w} value={p.price} />
          </div>
          <Stat label="Beta (5Y monthly)">{fmtFixed(p.beta)}</Stat>
          {isNum(p.target_mean_price) && (
            <Stat
              label={`Analyst target (${p.analyst_count ?? '?'})`}
              title="Mean analyst price target as reported by Yahoo"
            >
              {fmtPrice(p.target_mean_price)}
              {p.recommendation && (
                <span className="ml-1.5 text-fg-3 uppercase">
                  {p.recommendation.replace('_', ' ')}
                </span>
              )}
            </Stat>
          )}
        </div>
        <div>
          <SectionTitle>Valuation</SectionTitle>
          <Stat label="Market cap">{money(p.market_cap)}</Stat>
          <Stat label="Enterprise value">{money(p.enterprise_value)}</Stat>
          <Stat label="P/E (ttm / fwd)">
            {fmtMultiple(p.trailing_pe)} / {fmtMultiple(p.forward_pe)}
          </Stat>
          <Stat label="EV / EBITDA">{fmtMultiple(p.ev_to_ebitda)}</Stat>
          <Stat label="EV / revenue">{fmtMultiple(p.ev_to_revenue)}</Stat>
          <Stat label="Price / book">{fmtMultiple(p.price_to_book)}</Stat>
          <Stat label="EPS (ttm / fwd)">
            {fmtFixed(p.eps_ttm)} / {fmtFixed(p.eps_forward)}
          </Stat>
          <Stat label="Dividend yield / payout">
            {pct(p.dividend_yield)} / {pct(p.payout_ratio)}
          </Stat>
          <Stat label="Shares out / float">
            {fmtCompact(p.shares_outstanding)} / {fmtCompact(p.float_shares)}
          </Stat>
        </div>
        <div>
          <SectionTitle
            right={<span className="font-normal tracking-normal text-fg-3 normal-case">{fin}</span>}
          >
            Fundamentals (ttm)
          </SectionTitle>
          <Stat label="Revenue">{money(p.revenue_ttm, fin)}</Stat>
          <Stat label="EBITDA">{money(p.ebitda, fin)}</Stat>
          <Stat label="Free cash flow">{money(p.free_cash_flow, fin)}</Stat>
          <Stat label="Gross / operating margin">
            {pct(p.gross_margin)} / {pct(p.operating_margin)}
          </Stat>
          <Stat label="Net margin">{pct(p.profit_margin)}</Stat>
          <Stat label="ROE / ROA">
            {pct(p.return_on_equity)} / {pct(p.return_on_assets)}
          </Stat>
          <Stat label="Cash / debt">
            {fmtCompact(p.total_cash)} / {fmtCompact(p.total_debt)}
          </Stat>
          <Stat label="Debt / equity">
            {isNum(p.debt_to_equity) ? `${fmtFixed(p.debt_to_equity)}×` : '—'}
          </Stat>
          <Stat label="Current ratio">{fmtFixed(p.current_ratio)}</Stat>
        </div>
      </div>

      {p.summary && (
        <div className="px-3 pb-3">
          <SectionTitle
            right={
              p.website && (
                <a
                  href={p.website}
                  target="_blank"
                  rel="noreferrer"
                  className="font-normal tracking-normal text-fg-3 normal-case hover:text-fg"
                >
                  {p.website.replace(/^https?:\/\/(www\.)?/, '')} ↗
                </a>
              )
            }
          >
            Business
          </SectionTitle>
          <p className={`leading-relaxed text-fg-2 ${expanded ? '' : 'line-clamp-4'}`}>
            {p.summary}
          </p>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="mt-1 text-[10.5px] text-fg-3 hover:text-amber"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
          <div className="mt-2 grid gap-x-6 @xl:grid-cols-2">
            {p.employees !== null && (
              <Stat label="Employees">{p.employees.toLocaleString('en-US')}</Stat>
            )}
            {p.officers.slice(0, 3).map((o) => (
              <Stat key={o.name} label={o.title ?? 'Officer'}>
                <span className="font-sans">{o.name}</span>
              </Stat>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
