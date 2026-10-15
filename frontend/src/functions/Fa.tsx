import clsx from 'clsx'
import { useMemo } from 'react'
import { useFinancials } from '@/api/client'
import type { PeriodKind, StatementKind, StatementRow, Statements } from '@/api/types'
import { fmtCompact, fmtFixed, fmtMillions, fmtPct, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, Seg, Spacer, Spark, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

type View = StatementKind | 'ratios'

export function Fa({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const view = (pane.params.statement ?? 'income') as View
  const period = (pane.params.period ?? 'annual') as PeriodKind

  const toolbar = (
    <Toolbar>
      <Seg
        value={view}
        options={[
          { value: 'income', label: 'Income' },
          { value: 'balance', label: 'Balance sheet' },
          { value: 'cashflow', label: 'Cash flow' },
          { value: 'ratios', label: 'Ratios' },
        ]}
        onChange={(v) => setParams(pane.id, { statement: v })}
      />
      <Seg
        value={period}
        options={[
          { value: 'annual', label: 'Annual' },
          { value: 'quarterly', label: 'Quarterly' },
        ]}
        onChange={(v) => setParams(pane.id, { period: v })}
      />
      <Spacer />
    </Toolbar>
  )

  return view === 'ratios' ? (
    <Ratios symbol={pane.security} period={period} toolbar={toolbar} />
  ) : (
    <Statement symbol={pane.security} statement={view} period={period} toolbar={toolbar} />
  )
}

function Statement({
  symbol,
  statement,
  period,
  toolbar,
}: {
  symbol?: string
  statement: StatementKind
  period: PeriodKind
  toolbar: React.ReactNode
}) {
  const query = useFinancials(symbol, statement, period)
  return (
    <FnFrame
      query={query}
      toolbar={toolbar}
      footerExtra={
        query.data && (
          <>
            <span className="text-fg-4">·</span>
            <span>{query.data.data.currency ?? '?'} millions unless noted</span>
          </>
        )
      }
    >
      {(s) => <StatementTable s={s} />}
    </FnFrame>
  )
}

function formatValue(row: StatementRow, v: number | null) {
  if (row.unit === 'per_share') return fmtFixed(v)
  if (row.unit === 'shares') return fmtCompact(v, 1)
  return fmtMillions(v)
}

const periodLabel = (iso: string, period: PeriodKind) =>
  period === 'annual' ? `FY${iso.slice(0, 4)}` : `${iso.slice(0, 7)}`

function StatementTable({ s }: { s: Statements }) {
  if (s.rows.length === 0) return <div className="p-4 text-fg-3">No line items reported.</div>
  return (
    <div className="pane-scroll h-full">
      <table className="dt num">
        <thead>
          <tr>
            <th className="sticky left-0 z-[2] min-w-44 bg-surface">{s.currency ?? ''}</th>
            {s.periods.map((p) => (
              <th key={p} title={`Period ending ${p}`}>
                {periodLabel(p, s.period)}
              </th>
            ))}
            <th title="Change versus the previous period">Δ</th>
            <th>Trend</th>
          </tr>
        </thead>
        <tbody>
          {s.rows.map((row) => {
            const [prev, last] = row.values.slice(-2)
            const growth =
              isNum(prev) && isNum(last) && prev !== 0
                ? last / Math.abs(prev) - Math.sign(prev)
                : null
            const points = row.values.filter(isNum)
            return (
              <tr key={row.key} className={clsx(row.emphasis && 'font-semibold')}>
                <td
                  className={clsx(
                    'sticky left-0 z-[1] bg-surface font-sans',
                    row.emphasis ? 'text-fg' : 'text-fg-2',
                  )}
                  style={{ paddingLeft: 8 + row.indent * 12 }}
                >
                  {row.label}
                  {row.unit !== 'currency' && (
                    <span className="ml-1 font-normal text-fg-4">
                      {row.unit === 'per_share' ? '/sh' : '#'}
                    </span>
                  )}
                </td>
                {row.values.map((v, i) => (
                  <td
                    key={i}
                    className={clsx(
                      isNum(v) && v < 0 ? 'text-down/80' : row.emphasis ? 'text-fg' : 'text-fg-2',
                    )}
                  >
                    {formatValue(row, v)}
                  </td>
                ))}
                <td>
                  <Delta value={growth}>{fmtPct(growth, 1)}</Delta>
                </td>
                <td className="w-20">
                  <Spark values={points} width={64} height={14} color="var(--color-fg-3)" />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Ratios ────────────────────────────────────────────────────────────────────

type Getter = (key: string, i: number) => number | null

interface RatioDef {
  label: string
  group: string
  format: 'pct' | 'x'
  /** Computed per period from the three statements; null when an input is missing. */
  calc: (g: { inc: Getter; bal: Getter; cf: Getter }, i: number) => number | null
  note?: string
}

const div = (a: number | null, b: number | null) => (isNum(a) && isNum(b) && b !== 0 ? a / b : null)
const growth = (a: number | null, b: number | null) =>
  isNum(a) && isNum(b) && b > 0 ? a / b - 1 : null

const RATIOS: RatioDef[] = [
  { group: 'Growth', label: 'Revenue growth', format: 'pct', calc: ({ inc }, i) => growth(inc('Total Revenue', i), inc('Total Revenue', i - 1)) },
  { group: 'Growth', label: 'Operating income growth', format: 'pct', calc: ({ inc }, i) => growth(inc('Operating Income', i), inc('Operating Income', i - 1)) },
  { group: 'Growth', label: 'Diluted EPS growth', format: 'pct', calc: ({ inc }, i) => growth(inc('Diluted EPS', i), inc('Diluted EPS', i - 1)) },
  { group: 'Profitability', label: 'Gross margin', format: 'pct', calc: ({ inc }, i) => div(inc('Gross Profit', i), inc('Total Revenue', i)) },
  { group: 'Profitability', label: 'EBITDA margin', format: 'pct', calc: ({ inc }, i) => div(inc('EBITDA', i), inc('Total Revenue', i)) },
  { group: 'Profitability', label: 'Operating margin', format: 'pct', calc: ({ inc }, i) => div(inc('Operating Income', i), inc('Total Revenue', i)) },
  { group: 'Profitability', label: 'Net margin', format: 'pct', calc: ({ inc }, i) => div(inc('Net Income Common Stockholders', i), inc('Total Revenue', i)) },
  { group: 'Profitability', label: 'Effective tax rate', format: 'pct', calc: ({ inc }, i) => div(inc('Tax Provision', i), inc('Pretax Income', i)) },
  { group: 'Returns', label: 'Return on equity', format: 'pct', note: 'Net income ÷ period-end equity', calc: ({ inc, bal }, i) => div(inc('Net Income Common Stockholders', i), bal('Stockholders Equity', i)) },
  { group: 'Returns', label: 'Return on assets', format: 'pct', note: 'Net income ÷ period-end total assets', calc: ({ inc, bal }, i) => div(inc('Net Income Common Stockholders', i), bal('Total Assets', i)) },
  { group: 'Cash flow', label: 'FCF margin', format: 'pct', calc: ({ inc, cf }, i) => div(cf('Free Cash Flow', i), inc('Total Revenue', i)) },
  { group: 'Cash flow', label: 'Cash conversion (FCF ÷ NI)', format: 'x', calc: ({ inc, cf }, i) => div(cf('Free Cash Flow', i), inc('Net Income Common Stockholders', i)) },
  { group: 'Cash flow', label: 'Capex ÷ revenue', format: 'pct', calc: ({ inc, cf }, i) => { const c = cf('Capital Expenditure', i); return div(isNum(c) ? -c : null, inc('Total Revenue', i)) } },
  { group: 'Leverage & liquidity', label: 'Debt ÷ equity', format: 'x', calc: ({ bal }, i) => div(bal('Total Debt', i), bal('Stockholders Equity', i)) },
  { group: 'Leverage & liquidity', label: 'Net debt ÷ EBITDA', format: 'x', calc: ({ inc, bal }, i) => div(bal('Net Debt', i), inc('EBITDA', i)) },
  { group: 'Leverage & liquidity', label: 'Current ratio', format: 'x', calc: ({ bal }, i) => div(bal('Current Assets', i), bal('Current Liabilities', i)) },
  { group: 'Leverage & liquidity', label: 'Interest cover (EBIT ÷ interest)', format: 'x', calc: ({ inc }, i) => div(inc('EBIT', i), inc('Interest Expense', i)) },
] // prettier-ignore

function getter(s: Statements | undefined, periods: string[]): Getter {
  const rows = new Map(s?.rows.map((r) => [r.key, r]) ?? [])
  const col = new Map(s?.periods.map((p, i) => [p, i]) ?? [])
  return (key, i) => {
    const row = rows.get(key)
    const c = col.get(periods[i])
    return row && c !== undefined ? row.values[c] : null
  }
}

function Ratios({
  symbol,
  period,
  toolbar,
}: {
  symbol?: string
  period: PeriodKind
  toolbar: React.ReactNode
}) {
  const inc = useFinancials(symbol, 'income', period)
  const bal = useFinancials(symbol, 'balance', period)
  const cf = useFinancials(symbol, 'cashflow', period)

  const table = useMemo(() => {
    const periods = inc.data?.data.periods ?? []
    const g = {
      inc: getter(inc.data?.data, periods),
      bal: getter(bal.data?.data, periods),
      cf: getter(cf.data?.data, periods),
    }
    return {
      periods,
      rows: RATIOS.map((r) => ({ ...r, values: periods.map((_, i) => r.calc(g, i)) })),
    }
  }, [inc.data, bal.data, cf.data])

  return (
    <FnFrame query={inc} toolbar={toolbar}>
      {() => (
        <div className="pane-scroll h-full">
          <table className="dt num">
            <thead>
              <tr>
                <th className="sticky left-0 z-[2] min-w-52 bg-surface">Ratio</th>
                {table.periods.map((p) => (
                  <th key={p}>{periodLabel(p, period)}</th>
                ))}
                <th>Trend</th>
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r, idx) => (
                <RatioRow
                  key={r.label}
                  r={r}
                  showGroup={idx === 0 || table.rows[idx - 1].group !== r.group}
                  span={table.periods.length + 2}
                />
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10.5px] text-fg-3">
            Computed by Tessera from the statements above. Quarterly growth compares consecutive
            quarters (not year-over-year).
          </p>
        </div>
      )}
    </FnFrame>
  )
}

function RatioRow({
  r,
  showGroup,
  span,
}: {
  r: RatioDef & { values: (number | null)[] }
  showGroup: boolean
  span: number
}) {
  return (
    <>
      {showGroup && (
        <tr className="group">
          <td colSpan={span}>{r.group}</td>
        </tr>
      )}
      <tr>
        <td className="sticky left-0 z-[1] bg-surface pl-5 font-sans text-fg-2" title={r.note}>
          {r.label}
        </td>
        {r.values.map((v, i) => (
          <td key={i} className={clsx(isNum(v) && v < 0 ? 'text-down/80' : 'text-fg')}>
            {r.format === 'pct' ? fmtPct(v, 1, false) : isNum(v) ? `${fmtFixed(v, 2)}×` : '—'}
          </td>
        ))}
        <td className="w-20">
          <Spark values={r.values.filter(isNum)} width={64} height={14} color="var(--color-fg-3)" />
        </td>
      </tr>
    </>
  )
}
