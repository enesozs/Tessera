import { useMonitor } from '@/api/client'
import { useWorkspace } from '@/state/workspace'
import { FnFrame } from '@/ui/FnFrame'
import { QuoteTable } from './QuoteTable'
import type { FnProps } from './types'

export function Monitor({ pane, id }: FnProps & { id: 'WEI' | 'CMDTY' }) {
  const query = useMonitor(id)
  const selectSecurity = useWorkspace((s) => s.selectSecurity)
  const latest = query.data?.data.groups
    .flatMap((g) => g.rows.map((r) => r.quote?.as_of ?? ''))
    .sort()
    .at(-1)
  return (
    <FnFrame
      query={query}
      loadingRows={14}
      footerExtra={
        !pane.link && (
          <>
            <span className="text-fg-4">·</span>
            <span className="text-fg-4">link this pane (Alt+L) to drive charts</span>
          </>
        )
      }
    >
      {(m) => (
        <QuoteTable
          groups={m.groups}
          selected={pane.security}
          latestDate={latest}
          onSelect={(symbol) => selectSecurity(pane.id, symbol)}
        />
      )}
    </FnFrame>
  )
}
