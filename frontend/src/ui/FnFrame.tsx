import type { UseQueryResult } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Envelope } from '@/api/types'
import { ErrorState, Loading, ProvenanceBar } from './primitives'

/**
 * Standard body of a terminal function: optional toolbar, the content (rendered only once
 * data exists), loading/error states, and the provenance footer.
 */
export function FnFrame<T>({
  query,
  toolbar,
  children,
  errorHint,
  footerExtra,
  loadingRows,
  idle,
}: {
  query: UseQueryResult<Envelope<T>>
  toolbar?: ReactNode
  children: (data: T) => ReactNode
  errorHint?: ReactNode
  footerExtra?: ReactNode
  loadingRows?: number
  /** Shown when the query is disabled (nothing to fetch), instead of a loader. */
  idle?: ReactNode
}) {
  const envelope = query.data
  return (
    <div className="flex h-full min-h-0 flex-col">
      {toolbar}
      <div className="relative min-h-0 flex-1">
        {query.isFetching && envelope && (
          <div className="absolute inset-x-0 top-0 z-20 h-px animate-pulse bg-amber/70" />
        )}
        {envelope ? (
          children(envelope.data)
        ) : idle && query.isPending && query.fetchStatus === 'idle' ? (
          idle
        ) : query.isError ? (
          <ErrorState error={query.error} hint={errorHint} />
        ) : (
          <Loading rows={loadingRows} />
        )}
      </div>
      <ProvenanceBar meta={envelope?.meta} extra={footerExtra} />
    </div>
  )
}
