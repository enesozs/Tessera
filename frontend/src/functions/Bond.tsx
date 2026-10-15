import clsx from 'clsx'
import { useEffect, useMemo, useState } from 'react'
import { useBond } from '@/api/client'
import type { BondAnalysis, BondRequest, DayCount } from '@/api/types'
import { AXIS, EChart, TOOLTIP, type EChartsOption } from '@/charts/EChart'
import { fmtDate, fmtFixed, fmtPct, fmtSigned, isNum } from '@/lib/format'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { Delta, SectionTitle, Seg, Stat } from '@/ui/primitives'
import type { FnProps } from './types'

const yearsFromNow = (years: number, month: number) => {
  const d = new Date()
  return `${d.getFullYear() + years}-${String(month).padStart(2, '0')}-15`
}

// Illustrative templates, not real securities: edit any field afterwards.
const PRESETS: { label: string; params: Record<string, string> }[] = [
  { label: 'UST 2Y', params: { coupon: '3.875', maturity: yearsFromNow(2, 10), freq: '2', dc: 'ACT/ACT', curve: 'US', quote: 'price', value: '99.50' } },
  { label: 'UST 10Y', params: { coupon: '4.25', maturity: yearsFromNow(10, 8), freq: '2', dc: 'ACT/ACT', curve: 'US', quote: 'price', value: '95.50' } },
  { label: 'UST 30Y', params: { coupon: '4.75', maturity: yearsFromNow(30, 5), freq: '2', dc: 'ACT/ACT', curve: 'US', quote: 'price', value: '96.00' } },
  { label: 'US corp 5Y', params: { coupon: '5.50', maturity: yearsFromNow(5, 3), freq: '2', dc: '30/360', curve: 'US', quote: 'yield', value: '5.90' } },
  { label: 'EUR govt 10Y', params: { coupon: '3.10', maturity: yearsFromNow(10, 2), freq: '1', dc: 'ACT/ACT', curve: 'EA', quote: 'yield', value: '3.70' } },
] // prettier-ignore

const DEFAULTS = PRESETS[1].params

export function Bond({ pane }: FnProps) {
  const setParams = useWorkspace((s) => s.setParams)
  const p = { ...DEFAULTS, ...pane.params }
  const request = useMemo<BondRequest | null>(() => {
    const coupon = Number(p.coupon) / 100
    const value = p.quote === 'yield' ? Number(p.value) / 100 : Number(p.value)
    if (
      !Number.isFinite(coupon) ||
      !Number.isFinite(value) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.maturity)
    )
      return null
    return {
      coupon,
      maturity: p.maturity,
      frequency: Number(p.freq) as BondRequest['frequency'],
      day_count: p.dc as DayCount,
      quote: p.quote as 'price' | 'yield',
      value,
      curve: p.curve as 'US' | 'EA',
    }
  }, [p.coupon, p.maturity, p.freq, p.dc, p.quote, p.value, p.curve])
  const query = useBond(request)
  const set = (patch: Record<string, string>) => setParams(pane.id, patch)

  return (
    <div className="flex h-full min-h-0 flex-col @container">
      <div className="flex h-full min-h-0 flex-col @3xl:flex-row">
        <aside className="pane-scroll shrink-0 border-b border-line px-3 py-2 @3xl:w-[270px] @3xl:border-r @3xl:border-b-0">
          <SectionTitle>Templates</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((t) => (
              <button
                key={t.label}
                type="button"
                onClick={() => set(t.params)}
                className="h-[22px] rounded-[3px] border border-line px-1.5 text-[10.5px] text-fg-2 hover:border-amber-dim hover:text-amber"
              >
                {t.label}
              </button>
            ))}
          </div>
          <SectionTitle>Security</SectionTitle>
          <Field label="Coupon" suffix="%" value={p.coupon} onCommit={(v) => set({ coupon: v })} />
          <Field
            label="Maturity"
            value={p.maturity}
            onCommit={(v) => set({ maturity: v })}
            type="date"
          />
          <Row label="Frequency">
            <Seg
              value={p.freq}
              options={[
                { value: '1', label: 'A', hint: 'Annual' },
                { value: '2', label: 'S', hint: 'Semi-annual' },
                { value: '4', label: 'Q', hint: 'Quarterly' },
              ]}
              onChange={(v) => set({ freq: v })}
            />
          </Row>
          <Row label="Day count">
            <Seg
              value={p.dc}
              options={[
                { value: 'ACT/ACT', label: 'ACT/ACT', hint: 'ICMA — government bonds' },
                { value: '30/360', label: '30/360', hint: 'Bond basis — U.S. corporates' },
              ]}
              onChange={(v) => set({ dc: v })}
            />
          </Row>
          <SectionTitle>Quote</SectionTitle>
          <Row label="Solve from">
            <Seg
              value={p.quote}
              options={[
                { value: 'price', label: 'Price' },
                { value: 'yield', label: 'Yield' },
              ]}
              onChange={(v) => {
                // Keep the current analysis consistent when switching what is typed in.
                const a = query.data?.data
                set({
                  quote: v,
                  value: a
                    ? v === 'yield'
                      ? (a.ytm * 100).toFixed(4)
                      : a.clean.toFixed(4)
                    : p.value,
                })
              }}
            />
          </Row>
          <Field
            label={p.quote === 'price' ? 'Clean price' : 'Yield to maturity'}
            suffix={p.quote === 'price' ? '/100' : '%'}
            value={p.value}
            onCommit={(v) => set({ value: v })}
          />
          <Row label="Benchmark">
            <Seg
              value={p.curve}
              options={[
                { value: 'US', label: 'UST', hint: 'U.S. Treasury curve' },
                { value: 'EA', label: 'EUR AAA', hint: 'ECB euro-area AAA curve' },
              ]}
              onChange={(v) => set({ curve: v })}
            />
          </Row>
          <p className="mt-3 text-[10.5px] leading-relaxed text-fg-4">
            Templates are illustrative, not real CUSIPs or ISINs. Free sources don't publish
            individual bond prices, so enter the price or yield you see elsewhere.
          </p>
        </aside>
        <div className="min-h-0 flex-1">
          <FnFrame query={query} loadingRows={12}>
            {(a) => <Analysis a={a} />}
          </FnFrame>
        </div>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line/50 py-1">
      <span className="text-fg-2">{label}</span>
      {children}
    </div>
  )
}

function Field({
  label,
  value,
  onCommit,
  suffix,
  type = 'text',
}: {
  label: string
  value: string
  onCommit: (v: string) => void
  suffix?: string
  type?: 'text' | 'date'
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])
  const commit = () => draft !== value && onCommit(draft.trim())
  return (
    <Row label={label}>
      <div className="flex items-center rounded-[3px] border border-line bg-canvas focus-within:border-amber-dim">
        <input
          type={type}
          value={draft}
          aria-label={label}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
          className={clsx(
            'num h-[22px] bg-transparent px-1.5 text-right text-fg outline-none [color-scheme:dark]',
            type === 'date' ? 'w-32' : 'w-20',
          )}
        />
        {suffix && <span className="pr-1.5 text-[10.5px] text-fg-3">{suffix}</span>}
      </div>
    </Row>
  )
}

function Analysis({ a }: { a: BondAnalysis }) {
  const b = a.benchmark
  return (
    <div className="pane-scroll h-full @container">
      <div className="px-3 py-2">
        <div className="grid gap-x-6 @xl:grid-cols-2 @5xl:grid-cols-4">
          <div>
            <SectionTitle>Price</SectionTitle>
            <Stat label="Clean price">{fmtFixed(a.clean, 4)}</Stat>
            <Stat label={`Accrued (${a.days_accrued} days)`}>{fmtFixed(a.accrued, 4)}</Stat>
            <Stat label="Dirty (invoice) price">{fmtFixed(a.dirty, 4)}</Stat>
            <Stat label="Settlement">{fmtDate(a.settlement)}</Stat>
          </div>
          <div>
            <SectionTitle>Yield</SectionTitle>
            <Stat label="Yield to maturity">{fmtPct(a.ytm, 3, false)}</Stat>
            <Stat label="Current yield" title="Annual coupon ÷ clean price">
              {fmtPct(a.current_yield, 3, false)}
            </Stat>
            <Stat label="Previous / next coupon">
              {fmtDate(a.previous_coupon)} / {fmtDate(a.next_coupon)}
            </Stat>
          </div>
          <div>
            <SectionTitle>Risk</SectionTitle>
            <Stat
              label="Macaulay duration"
              title="Present-value-weighted average time to the cash flows, years"
            >
              {fmtFixed(a.risk.macaulay, 3)}
            </Stat>
            <Stat
              label="Modified duration"
              title="% price change for a 1-point (100bp) yield change"
            >
              {fmtFixed(a.risk.modified, 3)}
            </Stat>
            <Stat label="Convexity">{fmtFixed(a.risk.convexity, 2)}</Stat>
            <Stat label="DV01 (per 100)" title="Price change for a 1bp yield move">
              {fmtFixed(a.risk.dv01, 4)}
            </Stat>
          </div>
          <div>
            <SectionTitle>Spread</SectionTitle>
            <Stat
              label="Benchmark par yield"
              title={`${b.curve}, interpolated at ${fmtFixed(b.years, 2)} years`}
            >
              {fmtPct(b.par_yield, 3, false)}
            </Stat>
            <Stat label="G-spread" title="Yield minus the interpolated benchmark par yield">
              {isNum(b.g_spread_bp) ? `${fmtSigned(b.g_spread_bp, 1)} bp` : '—'}
            </Stat>
            <Stat
              label="Z-spread"
              title="Spread over the benchmark zero curve that reprices the bond"
            >
              {isNum(b.z_spread_bp) ? `${fmtSigned(b.z_spread_bp, 1)} bp` : '—'}
            </Stat>
            <Stat label="Benchmark">{b.curve}</Stat>
          </div>
        </div>
        <div className="grid gap-x-6 @4xl:grid-cols-2">
          <div>
            <SectionTitle>Price–yield curve</SectionTitle>
            <div className="h-[220px]">
              <PriceYield a={a} />
            </div>
          </div>
          <div>
            <SectionTitle>Parallel yield shocks</SectionTitle>
            <div className="overflow-x-auto">
              <table className="dt num">
                <thead>
                  <tr>
                    <th>Shift</th>
                    <th>Clean</th>
                    <th>Δ exact</th>
                    <th title="−D_mod × P × Δy">Δ duration</th>
                    <th title="… + ½ × convexity × P × Δy²">Δ dur + cvx</th>
                  </tr>
                </thead>
                <tbody>
                  {a.shocks.map((s) => (
                    <tr key={s.bp}>
                      <td className="text-fg-2">{s.bp > 0 ? `+${s.bp}` : s.bp} bp</td>
                      <td className="text-fg">{fmtFixed(s.clean, 3)}</td>
                      <td>
                        <Delta value={s.change}>{fmtSigned(s.change, 3)}</Delta>
                      </td>
                      <td className="text-fg-3">{fmtSigned(s.duration_estimate, 3)}</td>
                      <td className="text-fg-2">{fmtSigned(s.duration_convexity_estimate, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-[10.5px] text-fg-4">
              Duration alone overstates losses and understates gains; adding convexity closes most
              of the gap.
            </p>
          </div>
        </div>
        <SectionTitle>Cash flows (per 100 face)</SectionTitle>
        <table className="dt num">
          <thead>
            <tr>
              <th>Date</th>
              <th>Years</th>
              <th>Coupon</th>
              <th>Principal</th>
              <th>PV at YTM</th>
            </tr>
          </thead>
          <tbody>
            {a.cash_flows.map((c) => (
              <tr key={c.date}>
                <td className="text-fg-2">{fmtDate(c.date)}</td>
                <td className="text-fg-3">{fmtFixed(c.t, 3)}</td>
                <td className="text-fg">{fmtFixed(c.coupon, 4)}</td>
                <td className="text-fg">{c.principal ? fmtFixed(c.principal, 2) : ''}</td>
                <td className="text-fg-2">{fmtFixed(c.present_value, 4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function PriceYield({ a }: { a: BondAnalysis }) {
  const option = useMemo<EChartsOption>(() => {
    const y0 = a.ytm * 100
    // The duration tangent at today's yield: the straight line convexity curves away from.
    const tangent = a.price_yield.map(([y]) => [
      y * 100,
      a.clean - a.risk.modified * a.dirty * (y - a.ytm),
    ])
    return {
      animation: false,
      grid: { left: 46, right: 12, top: 24, bottom: 26 },
      tooltip: { ...TOOLTIP, valueFormatter: (v: number) => v.toFixed(3) },
      legend: {
        top: 0,
        left: 4,
        itemWidth: 10,
        itemHeight: 6,
        textStyle: { color: '#a3acb7', fontSize: 10.5 },
      },
      xAxis: {
        type: 'value',
        scale: true,
        ...AXIS,
        splitLine: { show: false },
        axisLabel: { ...AXIS.axisLabel, formatter: '{value}%' },
      },
      yAxis: { type: 'value', scale: true, ...AXIS },
      series: [
        {
          name: 'Clean price',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#ffb020', width: 2 },
          itemStyle: { color: '#ffb020' },
          data: a.price_yield.map(([y, p]) => [y * 100, p]),
          markPoint: {
            symbol: 'circle',
            symbolSize: 8,
            itemStyle: { color: '#ffb020' },
            label: { show: false },
            data: [{ coord: [y0, a.clean] }],
          },
        },
        {
          name: 'Duration tangent',
          type: 'line',
          showSymbol: false,
          lineStyle: { color: '#5aa9ff', width: 1, type: 'dashed' },
          itemStyle: { color: '#5aa9ff' },
          data: tangent,
        },
      ],
    }
  }, [a])
  return <EChart option={option} />
}
