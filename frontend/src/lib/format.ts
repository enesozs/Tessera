// Number and date formatting. Every function formats through here so units stay consistent.

const DASH = '—'

export function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** Price-like numbers: decimals adapt to magnitude (BTC vs a penny stock vs an FX cross). */
export function fmtPrice(v: number | null | undefined, decimals?: number): string {
  if (!isNum(v)) return DASH
  const d = decimals ?? (Math.abs(v) >= 1000 ? 2 : Math.abs(v) >= 10 ? 2 : Math.abs(v) >= 1 ? 3 : 4)
  return v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
}

export function fmtFixed(v: number | null | undefined, decimals = 2): string {
  if (!isNum(v)) return DASH
  return v.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

export function fmtSigned(v: number | null | undefined, decimals = 2): string {
  if (!isNum(v)) return DASH
  const s = fmtFixed(Math.abs(v), decimals)
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s
}

/** A fraction (0.0123) shown as a percentage (+1.23%). */
export function fmtPct(v: number | null | undefined, decimals = 2, signed = true): string {
  if (!isNum(v)) return DASH
  return signed ? `${fmtSigned(v * 100, decimals)}%` : `${fmtFixed(v * 100, decimals)}%`
}

/** Basis points from a difference in percent units (4.30 − 4.10 → +20 bp). */
export function fmtBpFromPct(v: number | null | undefined): string {
  if (!isNum(v)) return DASH
  return `${fmtSigned(v * 100, 0)}`
}

/** 1.23T / 456.7B / 12.3M / 4.5K. */
export function fmtCompact(v: number | null | undefined, decimals = 2): string {
  if (!isNum(v)) return DASH
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [size, suffix] of units)
    if (a >= size) return `${sign}${(a / size).toFixed(decimals)}${suffix}`
  return `${sign}${a.toFixed(0)}`
}

/** Statement figures in millions, accounting style: negatives in parentheses. */
export function fmtMillions(v: number | null | undefined): string {
  if (!isNum(v)) return DASH
  const m = v / 1e6
  const s = Math.abs(m).toLocaleString('en-US', {
    maximumFractionDigits: Math.abs(m) < 10 ? 1 : 0,
  })
  return m < 0 ? `(${s})` : s
}

export function fmtMultiple(v: number | null | undefined): string {
  return isNum(v) ? `${fmtFixed(v, v >= 100 ? 0 : 1)}×` : DASH
}

export function tone(v: number | null | undefined): 'up' | 'down' | 'flat' {
  if (!isNum(v) || v === 0) return 'flat'
  return v > 0 ? 'up' : 'down'
}

export const toneClass = { up: 'text-up', down: 'text-down', flat: 'text-fg-2' } as const

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-10-14' → '14 Oct 2026' (no timezone shifting for plain dates). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m) return iso
  return d ? `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}` : `${MONTHS[m - 1]} ${y}`
}

export function fmtMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return DASH
  const date = new Date(iso)
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  })
}

export function fmtAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return DASH
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}
