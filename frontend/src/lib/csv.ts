// Export every data table inside an element as CSV — works for any function without each one
// having to describe its own export.

function cell(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
}

export function tablesToCsv(root: ParentNode): string {
  const blocks: string[] = []
  root.querySelectorAll('table').forEach((table) => {
    const lines: string[] = []
    table.querySelectorAll('tr').forEach((tr) => {
      const cells = [...tr.querySelectorAll('th, td')].map((c) => cell(c.textContent ?? ''))
      if (cells.some((c) => c !== '')) lines.push(cells.join(','))
    })
    if (lines.length) blocks.push(lines.join('\n'))
  })
  return blocks.join('\n\n')
}

export function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}
