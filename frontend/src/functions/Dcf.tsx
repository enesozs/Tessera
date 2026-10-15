import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useDcfInputs, useDcfValue } from '@/api/client'
import type { DcfAssumptions, DcfInputs, DcfResult } from '@/api/types'
import { fmtCompact, fmtFixed, fmtMillions, fmtPct, fmtPrice, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, ErrorState, Loading, SectionTitle, Stat } from '@/ui/primitives'
import type { FnProps } from './types'

type NumericKey = Exclude<keyof DcfAssumptions, 'mid_year'>

interface Field {
  key: NumericKey
  label: string
  kind: 'pct' | 'num' | 'int'
  step: number
}

const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: 'Growth & margins',
    fields: [
      { key: 'years', label: 'Explicit forecast years', kind: 'int', step: 1 },
      { key: 'revenue_growth_start', label: 'Revenue growth, year 1', kind: 'pct', step: 0.005 },
      { key: 'terminal_growth', label: 'Terminal growth', kind: 'pct', step: 0.0025 },
      { key: 'ebit_margin_start', label: 'EBIT margin, year 1', kind: 'pct', step: 0.005 },
      { key: 'ebit_margin_target', label: 'EBIT margin, final year', kind: 'pct', step: 0.005 },
    ],
  },
  {
    title: 'Taxes & reinvestment',
    fields: [
      { key: 'tax_rate', label: 'Tax rate', kind: 'pct', step: 0.005 },
      { key: 'da_pct_revenue', label: 'D&A, % of revenue', kind: 'pct', step: 0.0025 },
      { key: 'capex_pct_revenue', label: 'Capex, % of revenue', kind: 'pct', step: 0.0025 },
      { key: 'nwc_pct_delta_revenue', label: 'ΔNWC, % of Δrevenue', kind: 'pct', step: 0.01 },
    ],
  },
  {
    title: 'Discount rate',
    fields: [
      { key: 'risk_free', label: 'Risk-free rate', kind: 'pct', step: 0.0025 },
      { key: 'equity_risk_premium', label: 'Equity risk premium', kind: 'pct', step: 0.0025 },
      { key: 'beta', label: 'Beta', kind: 'num', step: 0.05 },
      { key: 'cost_of_debt', label: 'Cost of debt (pre-tax)', kind: 'pct', step: 0.0025 },
    ],
  },
]

const overridesKey = (symbol: string) => `dcf:${symbol}`

export function Dcf({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const symbol = pane.security
  const inputs = useDcfInputs(symbol)
  const raw = symbol ? pane.params[overridesKey(symbol)] : undefined
  const overrides = useMemo<Partial<DcfAssumptions>>(() => {
    try {
      return raw ? JSON.parse(raw) : {}
    } catch {
      return {}
    }
  }, [raw])
  const assumptions = useMemo(
    () => (inputs.data ? { ...inputs.data.data.defaults, ...overrides } : undefined),
    [inputs.data, overrides],
  )
  const result = useDcfValue(symbol, assumptions)

  const save = (next: Partial<DcfAssumptions>) =>
    symbol && setParams(pane.id, { [overridesKey(symbol)]: JSON.stringify(next) })
  const set = (key: keyof DcfAssumptions, value: number | boolean) =>
    save({ ...overrides, [key]: value })
  const reset = (key?: keyof DcfAssumptions) => {
    if (!key) return save({})
    const next = { ...overrides }
    delete next[key]
    save(next)
  }

  return (
    <FnFrame query={inputs} loadingRows={14}>
      {(i) =>
        assumptions && (
          <div className="flex h-full min-h-0 @container">
            <div className="flex h-full min-h-0 w-full flex-col @3xl:flex-row">
              <Assumptions
                inputs={i}
                values={assumptions}
                overrides={overrides}
                onSet={set}
                onReset={reset}
              />
              <div className="pane-scroll min-h-0 flex-1 border-line @3xl:border-l">
                {result.data ? (
                  <Results
                    i={i}
                    r={result.data.data}
                    a={assumptions}
                    stale={result.isPlaceholderData}
                  />
                ) : result.isError ? (
                  <ErrorState error={result.error} hint="Adjust the assumptions on the left." />
                ) : (
                  <Loading rows={10} />
                )}
              </div>
            </div>
          </div>
        )
      }
    </FnFrame>
  )
}

// ── Assumptions panel ─────────────────────────────────────────────────────────

function Assumptions({
  inputs,
  values,
  overrides,
  onSet,
  onReset,
}: {
  inputs: DcfInputs
  values: DcfAssumptions
  overrides: Partial<DcfAssumptions>
  onSet: (key: keyof DcfAssumptions, value: number | boolean) => void
  onReset: (key?: keyof DcfAssumptions) => void
}) {
  const changed = Object.keys(overrides).length
  return (
    <aside className="pane-scroll shrink-0 border-b border-line px-3 py-2 @3xl:w-[300px] @3xl:border-b-0">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10.5px] text-fg-3">
          Base year FY{inputs.base_period.slice(0, 4)} · {inputs.financial_currency}
        </span>
        <button
          type="button"
          disabled={!changed}
          onClick={() => onReset()}
          className="text-[10.5px] text-fg-3 enabled:hover:text-amber disabled:opacity-40"
        >
          Reset all{changed ? ` (${changed})` : ''}
        </button>
      </div>
      {GROUPS.map((g) => (
        <div key={g.title}>
          <SectionTitle>{g.title}</SectionTitle>
          {g.fields.map((f) => (
            <AssumptionInput
              key={f.key}
              field={f}
              value={values[f.key]}
              source={inputs.sources[f.key]}
              changed={f.key in overrides}
              onCommit={(v) => onSet(f.key, v)}
              onReset={() => onReset(f.key)}
            />
          ))}
        </div>
      ))}
      <label className="mt-2 flex cursor-pointer items-center gap-2 text-fg-2">
        <input
          type="checkbox"
          checked={values.mid_year}
          onChange={(e) => onSet('mid_year', e.target.checked)}
          className="accent-amber"
        />
        Mid-year discounting
        <span className="text-[10.5px] text-fg-4">cash flows arrive mid-year on average</span>
      </label>
    </aside>
  )
}

function display(field: Field, v: number) {
  return field.kind === 'pct'
    ? (v * 100).toFixed(2)
    : field.kind === 'int'
      ? String(v)
      : v.toFixed(2)
}

function AssumptionInput({
  field,
  value,
  source,
  changed,
  onCommit,
  onReset,
}: {
  field: Field
  value: number
  source?: string
  changed: boolean
  onCommit: (v: number) => void
  onReset: () => void
}) {
  const [draft, setDraft] = useState(display(field, value))
  useEffect(() => setDraft(display(field, value)), [field, value])

  const commit = (text: string) => {
    const n = Number(text)
    if (!Number.isFinite(n)) return setDraft(display(field, value))
    const v = field.kind === 'pct' ? n / 100 : field.kind === 'int' ? Math.round(n) : n
    if (v !== value) onCommit(field.kind === 'int' ? Math.min(10, Math.max(3, v)) : v)
  }
  const nudge = (dir: 1 | -1) => {
    const v = Math.round((value + dir * field.step) * 1e6) / 1e6
    onCommit(field.kind === 'int' ? Math.min(10, Math.max(3, v)) : v)
  }

  return (
    <div className="border-b border-line/50 py-1">
      <div className="flex items-center gap-2">
        <span className={clsx('flex-1 truncate', changed ? 'text-amber' : 'text-fg-2')}>
          {field.label}
        </span>
        {changed && (
          <button
            type="button"
            onClick={onReset}
            title="Back to the default"
            className="text-[11px] text-fg-4 hover:text-amber"
          >
            ↺
          </button>
        )}
        <div className="flex items-center rounded-[3px] border border-line bg-canvas focus-within:border-amber-dim">
          <input
            value={draft}
            inputMode="decimal"
            aria-label={field.label}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
              else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault()
                nudge(e.key === 'ArrowUp' ? 1 : -1)
              }
            }}
            className="num h-[22px] w-16 bg-transparent px-1.5 text-right text-fg outline-none"
          />
          <span className="w-4 pr-1 text-[10.5px] text-fg-3">
            {field.kind === 'pct' ? '%' : ''}
          </span>
        </div>
      </div>
      {source && (
        <div className="truncate text-[10px] text-fg-4" title={source}>
          {changed ? `default: ${source}` : source}
        </div>
      )}
    </div>
  )
}

// ── Results ───────────────────────────────────────────────────────────────────

function Results({
  i,
  r,
  a,
  stale,
}: {
  i: DcfInputs
  r: DcfResult
  a: DcfAssumptions
  stale: boolean
}) {
  const v = r.valuation
  const base = Number(i.base_period.slice(0, 4))
  const history = i.history.slice(-3)
  const ccy = i.financial_currency
  const converted = r.financial_currency !== r.currency

  return (
    <div className={clsx('px-3 py-2 transition-opacity', stale && 'opacity-60')}>
      {/* Headline */}
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2 border-b border-line pb-2">
        <div>
          <div className="text-[10.5px] tracking-wide text-fg-3 uppercase">
            Intrinsic value / share
          </div>
          <div className="num text-[24px] leading-tight font-medium text-amber">
            {fmtPrice(r.per_share_quote)}{' '}
            <span className="text-[12px] text-fg-3">{r.currency}</span>
          </div>
        </div>
        <div>
          <div className="text-[10.5px] tracking-wide text-fg-3 uppercase">Price</div>
          <div className="num text-[16px] text-fg">{fmtPrice(r.price)}</div>
        </div>
        <div>
          <div className="text-[10.5px] tracking-wide text-fg-3 uppercase">Upside</div>
          <Delta value={r.upside} className="text-[16px]">
            {fmtPct(r.upside, 1)}
          </Delta>
        </div>
        <div className="grid min-w-[300px] flex-1 grid-cols-2 gap-x-5 @5xl:grid-cols-4">
          <Stat label="WACC">{fmtPct(v.wacc.wacc, 2, false)}</Stat>
          <Stat label="Enterprise value">{fmtCompact(v.enterprise_value)}</Stat>
          <Stat
            label="TV share of EV"
            title="Share of enterprise value coming from beyond the forecast horizon"
          >
            {fmtPct(v.terminal_share_of_ev, 0, false)}
          </Stat>
          <Stat
            label="Implied exit EV/EBITDA"
            title="Terminal value ÷ final-year EBITDA — a sanity check against trading multiples"
          >
            {isNum(v.implied_exit_ev_ebitda) ? `${fmtFixed(v.implied_exit_ev_ebitda, 1)}×` : '—'}
          </Stat>
        </div>
      </div>

      {/* Projection */}
      <SectionTitle
        right={
          <span className="font-normal tracking-normal text-fg-3 normal-case">
            {ccy} millions · A = actual, E = Tessera projection
          </span>
        }
      >
        Free cash flow projection
      </SectionTitle>
      <div className="overflow-x-auto">
        <table className="dt num">
          <thead>
            <tr>
              <th />
              {history.map((h) => (
                <th key={h.period} className="!text-fg-4">
                  FY{h.period.slice(2, 4)}A
                </th>
              ))}
              {v.projection.map((p) => (
                <th key={p.year}>FY{String(base + p.year).slice(2)}E</th>
              ))}
              <th title="Year N+1, the first year of the perpetuity">Terminal</th>
            </tr>
          </thead>
          <tbody>
            <ProjRow
              label="Revenue"
              hist={history.map((h) => h.revenue)}
              proj={v.projection.map((p) => p.revenue)}
              bold
            />
            <ProjRow
              label="Growth"
              hist={history.map((h) => h.growth)}
              proj={v.projection.map((p) => p.growth)}
              pct
              sub
              tail={a.terminal_growth}
            />
            <ProjRow
              label="EBIT"
              hist={history.map((h) => h.ebit)}
              proj={v.projection.map((p) => p.ebit)}
            />
            <ProjRow
              label="Margin"
              hist={history.map((h) => h.margin)}
              proj={v.projection.map((p) => p.margin)}
              pct
              sub
              tail={a.ebit_margin_target}
            />
            <ProjRow
              label="− Taxes"
              hist={history.map(() => null)}
              proj={v.projection.map((p) => -p.taxes)}
            />
            <ProjRow
              label="NOPAT"
              hist={history.map(() => null)}
              proj={v.projection.map((p) => p.nopat)}
            />
            <ProjRow
              label="+ D&A"
              hist={history.map((h) => h.da)}
              proj={v.projection.map((p) => p.da)}
            />
            <ProjRow
              label="− Capex"
              hist={history.map((h) => (isNum(h.capex) ? -h.capex : null))}
              proj={v.projection.map((p) => -p.capex)}
            />
            <ProjRow
              label="− ΔNWC"
              hist={history.map((h) => (isNum(h.delta_nwc) ? -h.delta_nwc : null))}
              proj={v.projection.map((p) => -p.delta_nwc)}
            />
            <ProjRow
              label="FCFF"
              hist={history.map((h) => h.fcff)}
              proj={v.projection.map((p) => p.fcff)}
              bold
              tail={v.terminal_fcff}
            />
            <ProjRow
              label="Discount factor"
              hist={history.map(() => null)}
              proj={v.projection.map((p) => p.discount_factor)}
              raw
              sub
            />
            <ProjRow
              label="PV of FCFF"
              hist={history.map(() => null)}
              proj={v.projection.map((p) => p.present_value)}
              bold
              tail={v.pv_terminal_value}
            />
          </tbody>
        </table>
      </div>

      <div className="grid gap-x-8 @4xl:grid-cols-3">
        {/* Bridge */}
        <div>
          <SectionTitle>Enterprise → equity value</SectionTitle>
          <Stat label="Σ PV of FCFF">{fmtMillions(v.sum_pv_fcff)}</Stat>
          <Stat label="+ PV of terminal value">{fmtMillions(v.pv_terminal_value)}</Stat>
          <Stat label={<span className="text-fg">= Enterprise value</span>}>
            {fmtMillions(v.enterprise_value)}
          </Stat>
          <Stat label="− Debt">{fmtMillions(-i.capital.total_debt)}</Stat>
          <Stat label="+ Cash & ST investments">{fmtMillions(i.capital.cash)}</Stat>
          <Stat label="− Minority interest">{fmtMillions(-i.capital.minority_interest)}</Stat>
          <Stat label={<span className="text-fg">= Equity value</span>}>
            {fmtMillions(v.equity_value)}
          </Stat>
          <Stat label="÷ Shares (millions)">{fmtFixed(i.capital.shares / 1e6, 1)}</Stat>
          <Stat label={`= Per share (${ccy})`}>{fmtPrice(v.per_share)}</Stat>
          {converted && (
            <Stat
              label={`× ${ccy}/${r.currency} ${r.fx_rate.toFixed(4)}`}
              title="ECB reference rate"
            >
              {fmtPrice(r.per_share_quote)} {r.currency}
            </Stat>
          )}
        </div>
        {/* WACC */}
        <div>
          <SectionTitle>Cost of capital</SectionTitle>
          <Stat label="Risk-free rate">{fmtPct(a.risk_free, 2, false)}</Stat>
          <Stat label="+ β × ERP">
            {fmtFixed(a.beta, 2)} × {fmtPct(a.equity_risk_premium, 2, false)}
          </Stat>
          <Stat label="= Cost of equity">{fmtPct(v.wacc.cost_of_equity, 2, false)}</Stat>
          <Stat label="Cost of debt after tax">
            {fmtPct(v.wacc.cost_of_debt_after_tax, 2, false)}
          </Stat>
          <Stat label="Weights E / D" title="Market value of equity, book value of debt">
            {fmtPct(v.wacc.weight_equity, 0, false)} / {fmtPct(v.wacc.weight_debt, 0, false)}
          </Stat>
          <Stat label={<span className="text-fg">= WACC</span>}>
            {fmtPct(v.wacc.wacc, 2, false)}
          </Stat>
        </div>
        {/* Sensitivity */}
        <div>
          <SectionTitle
            right={
              <span className="font-normal tracking-normal text-fg-3 normal-case">
                value / share, {r.currency}
              </span>
            }
          >
            Sensitivity
          </SectionTitle>
          <SensitivityGrid r={r} />
        </div>
      </div>
      <p className="mt-3 text-[10.5px] leading-relaxed text-fg-4">
        A mechanical model, not a recommendation. Revenue growth fades linearly to terminal growth;
        margins move linearly to the final-year target; terminal value uses Gordon growth on year
        N+1 free cash flow. Change any input on the left (↑/↓ nudges it).
      </p>
    </div>
  )
}

function ProjRow({
  label,
  hist,
  proj,
  tail,
  pct,
  raw,
  bold,
  sub,
}: {
  label: string
  hist: (number | null)[]
  proj: number[]
  tail?: number
  pct?: boolean
  raw?: boolean
  bold?: boolean
  sub?: boolean
}) {
  const fmt = (x: number | null | undefined) =>
    pct ? fmtPct(x, 1, false) : raw ? fmtFixed(x, 3) : fmtMillions(x)
  return (
    <tr className={clsx(bold && 'font-semibold')}>
      <td className={clsx('font-sans', sub ? 'pl-5 text-fg-3' : bold ? 'text-fg' : 'text-fg-2')}>
        {label}
      </td>
      {hist.map((x, i) => (
        <td key={`h${i}`} className="text-fg-4">
          {fmt(x)}
        </td>
      ))}
      {proj.map((x, i) => (
        <td
          key={i}
          className={clsx(
            isNum(x) && x < 0 ? 'text-down/80' : bold ? 'text-fg' : 'text-fg-2',
            sub && 'text-fg-3',
          )}
        >
          {fmt(x)}
        </td>
      ))}
      <td className="text-fg-3">{tail !== undefined ? fmt(tail) : ''}</td>
    </tr>
  )
}

function SensitivityGrid({ r }: { r: DcfResult }) {
  const s = r.sensitivity
  const mid = Math.floor(s.waccs.length / 2)
  return (
    <table className="dt num">
      <thead>
        <tr>
          <th className="!text-[9.5px]">WACC ↓ g →</th>
          {s.growths.map((g) => (
            <th key={g}>{fmtPct(g, 1, false)}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {s.waccs.map((w, i) => (
          <tr key={w}>
            <td className="text-fg-3">{fmtPct(w, 1, false)}</td>
            {s.per_share[i].map((x, j) => {
              const ratio = isNum(x) && r.price ? x / r.price - 1 : null
              const strength = isNum(ratio) ? Math.min(1, Math.abs(ratio) / 0.5) * 0.35 : 0
              return (
                <td
                  key={j}
                  className={clsx(
                    i === mid &&
                      j === mid &&
                      'font-bold text-amber outline outline-1 -outline-offset-1 outline-amber/60',
                  )}
                  style={{
                    background: isNum(ratio)
                      ? `rgba(${ratio >= 0 ? '46,194,126' : '255,93,93'},${strength})`
                      : undefined,
                  }}
                  title={isNum(ratio) ? `${fmtPct(ratio, 1)} vs price` : 'WACC too close to growth'}
                >
                  {isNum(x) ? fmtPrice(x, x >= 100 ? 0 : 2) : '—'}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
