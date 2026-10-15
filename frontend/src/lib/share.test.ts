import { describe, expect, it } from 'vitest'
import { decode, encode, sanitizePanes } from './share'

describe('share links', () => {
  it('round-trips unicode workspace names', () => {
    const ws = {
      name: 'Equity · RACE',
      panes: [{ fn: 'GP', security: 'RACE', params: { range: '2Y' }, link: 'violet' }],
    }
    const text = encode(ws)
    expect(text).toMatch(/^[\w-]+$/) // URL-safe
    expect(decode(text)).toEqual(ws)
  })

  it('rejects garbage and unknown functions', () => {
    expect(decode('%%%')).toBeNull()
    const isCode = (fn: string) => ['GP', 'DES'].includes(fn)
    const panes = sanitizePanes(
      [
        { fn: 'GP', security: 'AAPL', params: { range: '1Y', bad: 3 } },
        { fn: 'EVIL' },
        'x',
        { fn: null },
      ],
      isCode,
    )
    expect(panes).toEqual([
      { fn: 'GP', security: 'AAPL', params: { range: '1Y' }, link: null },
      { fn: null, security: undefined, params: {}, link: null },
    ])
  })
})
