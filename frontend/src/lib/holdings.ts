import { isTicker } from './command'

/** "SYMBOL SHARES" per line (commas, tabs or spaces); returns holdings and bad lines. */
export function parseHoldings(text: string) {
  const holdings: { symbol: string; shares: number }[] = []
  const errors: string[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || /^symbol/i.test(line)) continue
    const [sym, qty] = line.split(/[\s,;]+/)
    const symbol = sym?.toUpperCase() ?? ''
    const shares = Number(qty)
    if (!isTicker(symbol) || !Number.isFinite(shares) || shares <= 0) errors.push(line)
    else holdings.push({ symbol, shares })
  }
  return { holdings, errors }
}
