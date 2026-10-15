import { describe, expect, it } from 'vitest'
import { parseHoldings } from './holdings'

describe('parseHoldings', () => {
  it('reads spaces, commas, tabs, a header row and comments', () => {
    const text = 'Symbol,Shares\naapl 50\nRACE.MI,20\nSAP.DE\t30\n# cash later\n\n'
    expect(parseHoldings(text)).toEqual({
      holdings: [
        { symbol: 'AAPL', shares: 50 },
        { symbol: 'RACE.MI', shares: 20 },
        { symbol: 'SAP.DE', shares: 30 },
      ],
      errors: [],
    })
  })

  it('reports lines it cannot use', () => {
    expect(parseHoldings('MSFT -5\nNVDA ten\nGLD 1.5').errors).toEqual(['MSFT -5', 'NVDA ten'])
  })
})
