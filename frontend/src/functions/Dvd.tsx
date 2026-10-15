import { useMemo } from 'react'
import { useDividends, useProfile } from '@/api/client'
import type { Dividends } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { fmtDate, fmtPct, fmtPrice, isNum } from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, SectionTitle, Stat } from '@/ui/primitives'
import type { FnProps } from './types'

export function Dvd({ pane }: FnProps) {
  const query = useDividends(pane.security)
  const profile = useProfile(pane.security)
  return (
    <FnFrame query={query}>
      {(d) => <DvdBody d={d} price={profile.data?.data.price ?? null} />}
    </FnFrame>
  )
}

/** Compound annual growth of annual totals over the last `years` complete years. */
export function dividendCagr(
  annual: Dividends['annual'],
  currentYear: number,
  years: number,
): number | null {
  const complete = annual.filter((a) => a.year < currentYear)
  const last = complete.at(-1)
  const first = complete.find((a) => last && a.year === last.year - years)
  return last && first && first.total > 0 ? (last.total / first.total) ** (1 / years) - 1 : null
}

function DvdBody({ d, price }: { d: Dividends; price: number | null }) {
  const year = new Date().getFullYear()
  const annual = useMemo(() => {
    // A continuous axis: years without a dividend show as gaps, not as if they never existed.
    const by = new Map(d.annual.map((a) => [a.year, a.total]))
    const last = d.annual.at(-1)?.year ?? year
    const first = Math.max(d.annual[0]?.year ?? last, last - 19)
    return Array.from({ length: last - first + 1 }, (_, i) => ({
      year: first + i,
      total: by.get(first + i) ?? 0,
    }))
  }, [d.annual, year])
  const ttmYield =
    isNum(d.trailing_12m) && isNum(price) && price > 0 ? d.trailing_12m / price : null
  const amountDigits = (d.payments.at(-1)?.amount ?? 1) < 0.1 ? 4 : 3

  const option = useMemo<EChartsOption>(
    () => ({
      animation: false,
      grid: { left: 44, right: 10, top: 14, bottom: 22 },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => v.toFixed(amountDigits) },
      xAxis: {
        type: 'category',
        data: annual.map((a) => String(a.year)),
        ...AXIS,
        splitLine: { show: false },
      },
      yAxis: { type: 'value', ...AXIS },
      series: [
        {
          name: `Dividends per share (${d.currency ?? ''})`,
          type: 'bar',
          barWidth: '60%',
          data: annual.map((a) => ({
            value: a.total,
            itemStyle: { color: a.year === year ? '#8a6215' : '#ffb020' },
          })),
        },
      ],
    }),
    [annual, d.currency, year, amountDigits],
  )

  const payments = [...d.payments].reverse()
  return (
    <div className="pane-scroll h-full px-3 py-2 @container">
      <div className="grid gap-x-6 border-b border-line pb-2 @xl:grid-cols-2 @4xl:grid-cols-4">
        <Stat label={`Trailing 12M (${d.currency ?? ''})`}>
          {fmtPrice(d.trailing_12m, amountDigits)}
        </Stat>
        <Stat label="Trailing yield" title="Trailing 12-month dividends ÷ current price">
          {fmtPct(ttmYield, 2, false)}
        </Stat>
        <Stat label="5Y dividend CAGR" title="Complete calendar years only">
          <Delta value={dividendCagr(d.annual, year, 5)}>
            {fmtPct(dividendCagr(d.annual, year, 5), 1)}
          </Delta>
        </Stat>
        <Stat label="Next ex-date / pay date">
          {d.next_ex_date ? fmtDate(d.next_ex_date) : '—'} /{' '}
          {d.next_pay_date ? fmtDate(d.next_pay_date) : '—'}
        </Stat>
      </div>
      {annual.length > 0 && (
        <>
          <SectionTitle
            right={
              <span className="font-normal tracking-normal text-fg-4 normal-case">
                current year in dark amber (partial)
              </span>
            }
          >
            Annual dividends per share
          </SectionTitle>
          <div className="h-[180px]">
            <EChart option={option} />
          </div>
        </>
      )}
      <div className="grid gap-x-6 @3xl:grid-cols-[2fr_1fr]">
        <div>
          <SectionTitle>Payments (ex-dividend date)</SectionTitle>
          <table className="dt num">
            <thead>
              <tr>
                <th>Ex-date</th>
                <th>Amount</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              {payments.slice(0, 40).map((p, i) => {
                const prev = payments[i + 1]
                const chg = prev ? p.amount / prev.amount - 1 : null
                return (
                  <tr key={p.date}>
                    <td className="text-fg-2">{fmtDate(p.date)}</td>
                    <td className="text-fg">{fmtPrice(p.amount, amountDigits)}</td>
                    <td>
                      <Delta value={chg}>{chg ? fmtPct(chg, 1) : '—'}</Delta>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div>
          <SectionTitle>Annual totals</SectionTitle>
          <table className="dt num">
            <thead>
              <tr>
                <th>Year</th>
                <th>Total</th>
                <th>#</th>
                <th>Growth</th>
              </tr>
            </thead>
            <tbody>
              {[...d.annual]
                .reverse()
                .slice(0, 15)
                .map((a) => (
                  <tr key={a.year}>
                    <td className="text-fg-2">
                      {a.year}
                      {a.year === year && <span className="ml-1 text-fg-4">YTD</span>}
                    </td>
                    <td className="text-fg">{fmtPrice(a.total, amountDigits)}</td>
                    <td className="text-fg-3">{a.payments}</td>
                    <td>
                      <Delta value={a.growth}>{fmtPct(a.growth, 1)}</Delta>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          {d.splits.length > 0 && (
            <>
              <SectionTitle>Stock splits</SectionTitle>
              <table className="dt num">
                <tbody>
                  {[...d.splits].reverse().map((s) => (
                    <tr key={s.date}>
                      <td className="text-fg-2">{fmtDate(s.date)}</td>
                      <td className="text-fg">
                        {s.ratio >= 1 ? `${s.ratio}:1` : `1:${(1 / s.ratio).toFixed(0)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
