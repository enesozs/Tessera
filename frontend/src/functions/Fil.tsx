import { useState } from 'react'
import { useFilings } from '@/api/client'
import { fmtDate } from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Seg, Spacer, Toolbar } from '@/ui/primitives'
import type { FnProps } from './types'

export function Fil({ pane }: FnProps) {
  const query = useFilings(pane.security)
  const [scope, setScope] = useState<'major' | 'all'>('major')
  return (
    <FnFrame
      query={query}
      errorHint={
        <>
          EDGAR asks every client to identify itself. Add{' '}
          <code className="num text-fg-2">SEC_USER_AGENT="Your Name you@example.com"</code> to{' '}
          <code className="num text-fg-2">.env</code> in the project root and restart the API.
        </>
      }
      toolbar={
        <Toolbar>
          <Seg
            value={scope}
            options={[
              {
                value: 'major',
                label: 'Major forms',
                hint: '10-K, 10-Q, 8-K, 20-F, 6-K, proxies, registrations',
              },
              { value: 'all', label: 'All' },
            ]}
            onChange={setScope}
          />
          <Spacer />
          {query.data && (
            <span className="text-[10.5px] text-fg-3">
              {query.data.data.company} · CIK <span className="num">{query.data.data.cik}</span>
            </span>
          )}
        </Toolbar>
      }
    >
      {(f) => (
        <div className="pane-scroll h-full">
          <table className="dt">
            <thead>
              <tr>
                <th>Filed</th>
                <th className="!text-left">Form</th>
                <th className="!text-left">Description</th>
                <th>Period</th>
              </tr>
            </thead>
            <tbody>
              {f.filings
                .filter((x) => scope === 'all' || x.major)
                .map((x) => (
                  <tr key={x.url}>
                    <td className="num text-fg-2">{fmtDate(x.filed)}</td>
                    <td className="!text-left">
                      <a
                        href={x.url}
                        target="_blank"
                        rel="noreferrer"
                        className="num font-medium text-amber hover:underline"
                      >
                        {x.form}
                      </a>
                    </td>
                    <td className="max-w-0 truncate !text-left text-fg-2">
                      {x.description ?? '—'}
                    </td>
                    <td className="num text-fg-3">
                      {x.report_date ? fmtDate(x.report_date) : '—'}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </FnFrame>
  )
}
