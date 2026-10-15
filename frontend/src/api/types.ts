// Mirrors backend/src/tessera models. Keep in sync when a response model changes.

export type Freshness = 'delayed' | 'end_of_day' | 'reference' | 'periodic' | 'filing'

export interface Provenance {
  source: string
  source_url: string | null
  freshness: Freshness
  as_of: string | null
  retrieved_at: string
  stale: boolean
  notes: string[]
}

export interface Envelope<T> {
  data: T
  meta: Provenance
}

export interface SecurityHit {
  symbol: string
  name: string
  exchange: string | null
  type: string | null
  sector: string | null
}

export interface Profile {
  symbol: string
  name: string
  quote_type: string | null
  exchange: string | null
  currency: string | null
  financial_currency: string | null
  country: string | null
  sector: string | null
  industry: string | null
  website: string | null
  employees: number | null
  summary: string | null
  officers: { name: string; title: string | null }[]
  timezone: string | null
  market_time: string | null
  market_state: string | null
  price: number | null
  previous_close: number | null
  change: number | null
  change_pct: number | null
  open: number | null
  day_low: number | null
  day_high: number | null
  low_52w: number | null
  high_52w: number | null
  volume: number | null
  avg_volume_3m: number | null
  market_cap: number | null
  enterprise_value: number | null
  shares_outstanding: number | null
  float_shares: number | null
  trailing_pe: number | null
  forward_pe: number | null
  price_to_book: number | null
  ev_to_ebitda: number | null
  ev_to_revenue: number | null
  eps_ttm: number | null
  eps_forward: number | null
  dividend_yield: number | null
  payout_ratio: number | null
  beta: number | null
  revenue_ttm: number | null
  ebitda: number | null
  gross_margin: number | null
  operating_margin: number | null
  profit_margin: number | null
  return_on_equity: number | null
  return_on_assets: number | null
  debt_to_equity: number | null
  current_ratio: number | null
  total_cash: number | null
  total_debt: number | null
  free_cash_flow: number | null
  target_mean_price: number | null
  analyst_count: number | null
  recommendation: string | null
}

export type Span = 'intraday1d' | 'intraday5d' | 'daily' | 'weekly'

export interface Bar {
  time: string | number
  open: number
  high: number
  low: number
  close: number
  adj_close: number | null
  volume: number
}

export interface History {
  symbol: string
  span: Span
  interval: string
  currency: string | null
  timezone: string | null
  bars: Bar[]
  events: { time: string; kind: 'dividend' | 'split'; value: number }[]
}

export type StatementKind = 'income' | 'balance' | 'cashflow'
export type PeriodKind = 'annual' | 'quarterly'

export interface StatementRow {
  key: string
  label: string
  emphasis: boolean
  indent: number
  unit: 'currency' | 'per_share' | 'shares'
  values: (number | null)[]
}

export interface Statements {
  symbol: string
  statement: StatementKind
  period: PeriodKind
  currency: string | null
  periods: string[]
  rows: StatementRow[]
}

export interface Headline {
  title: string
  link: string
  published_at: string | null
  summary: string | null
}

export interface Filing {
  form: string
  filed: string
  report_date: string | null
  description: string | null
  url: string
  major: boolean
}

export interface Filings {
  symbol: string
  cik: number
  company: string
  filings: Filing[]
}

export interface Quote {
  symbol: string
  last: number
  previous_close: number | null
  change: number | null
  change_pct: number | null
  change_1m_pct: number | null
  change_ytd_pct: number | null
  high_52w: number | null
  low_52w: number | null
  as_of: string
  spark: number[]
}

export interface Monitor {
  id: string
  groups: {
    name: string
    rows: { symbol: string; name: string; tag: string; quote: Quote | null }[]
  }[]
}

export interface CurveSnapshot {
  label: string
  date: string
  yields: (number | null)[]
}

export interface YieldCurve {
  region: 'US' | 'EA'
  name: string
  basis: string
  tenors: string[]
  tenor_years: number[]
  snapshots: CurveSnapshot[]
  history: { dates: string[]; series: Record<string, (number | null)[]> }
}

export interface SovereignYields {
  benchmark: string
  months: string[]
  series: {
    country: string
    name: string
    yields: (number | null)[]
    spread_bp: (number | null)[]
  }[]
}

export interface FxMatrix {
  currencies: string[]
  date: string
  previous_date: string
  rates: number[][]
  change_pct: number[][]
}

export interface FxHistory {
  base: string
  quote: string
  points: { date: string; rate: number }[]
}

export interface Observation {
  date: string
  value: number
}

export interface MacroSeries {
  id: string
  title: string
  region: string
  source: string
  source_key: string
  frequency: string
  units: string
  transform: string
  higher_is_better: boolean | null
  observations: Observation[]
}

export interface MacroSummary {
  id: string
  title: string
  region: string
  source: string
  frequency: string
  units: string
  higher_is_better: boolean | null
  latest: Observation | null
  previous: Observation | null
  spark: number[]
}
