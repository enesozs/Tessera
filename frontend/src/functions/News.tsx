import { useState } from 'react'
import { useNews } from '@/api/client'
import { fmtAgo, fmtDateTime } from '@/lib/format'
import { FnFrame } from '@/ui/FnFrame'
import { Empty } from '@/ui/primitives'
import type { FnProps } from './types'

export function News({ pane }: FnProps) {
  const query = useNews(pane.security)
  const [open, setOpen] = useState<string | null>(null)
  return (
    <FnFrame query={query}>
      {(items) =>
        items.length === 0 ? (
          <Empty>No recent headlines{pane.security ? ` for ${pane.security}` : ''}.</Empty>
        ) : (
          <div className="pane-scroll h-full">
            {!pane.security && (
              <div className="border-b border-line px-3 py-1 text-[10.5px] tracking-wide text-fg-3 uppercase">
                Top market headlines
              </div>
            )}
            <ul>
              {items.map((h) => (
                <li key={h.link} className="group border-b border-line/60 hover:bg-hover">
                  <div className="flex items-start gap-3 px-3 py-1.5">
                    <span
                      className="num w-9 shrink-0 pt-px text-right text-fg-3"
                      title={fmtDateTime(h.published_at)}
                    >
                      {fmtAgo(h.published_at)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <a
                        href={h.link}
                        target="_blank"
                        rel="noreferrer"
                        className="text-fg group-hover:text-amber"
                      >
                        {h.title}
                      </a>
                      {h.summary && (
                        <p
                          onClick={() => setOpen(open === h.link ? null : h.link)}
                          className={`mt-0.5 cursor-pointer text-fg-3 ${open === h.link ? '' : 'line-clamp-1'}`}
                        >
                          {h.summary}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )
      }
    </FnFrame>
  )
}
