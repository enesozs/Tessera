// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { tablesToCsv } from './csv'

describe('tablesToCsv', () => {
  it('flattens tables, quoting cells that need it', () => {
    const root = document.createElement('div')
    root.innerHTML = `
      <table><tr><th>Name</th><th>Value</th></tr>
             <tr><td>Ferrari N.V.</td><td>1,234.5</td></tr>
             <tr><td>Say "hi"</td><td> 2 </td></tr></table>
      <table><tr><td>second</td></tr></table>`
    expect(tablesToCsv(root)).toBe('Name,Value\nFerrari N.V.,"1,234.5"\n"Say ""hi""",2\n\nsecond')
  })
})
