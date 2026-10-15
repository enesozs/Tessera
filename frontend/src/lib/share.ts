// Workspaces and panes travel in URLs as base64url-encoded JSON: share links (?ws=) and
// pop-out windows (?popout=). Nothing is sent to a server.

export interface PaneSpec {
  fn: string | null
  security?: string
  params: Record<string, string>
  link: string | null
}

export interface WorkspaceSpec {
  name: string
  panes: PaneSpec[]
}

export function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decode<T>(text: string): T | null {
  try {
    const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return JSON.parse(new TextDecoder().decode(bytes)) as T
  } catch {
    return null
  }
}

/** Keep only well-formed panes from untrusted input (a link anyone could have edited). */
export function sanitizePanes(panes: unknown, isCode: (fn: string) => boolean): PaneSpec[] {
  if (!Array.isArray(panes)) return []
  return panes.slice(0, 6).flatMap((p) => {
    if (typeof p !== 'object' || p === null) return []
    const { fn, security, params, link } = p as Record<string, unknown>
    if (fn !== null && (typeof fn !== 'string' || !isCode(fn))) return []
    const safeParams: Record<string, string> = {}
    if (params && typeof params === 'object')
      for (const [k, v] of Object.entries(params))
        if (typeof v === 'string' && v.length < 600) safeParams[k] = v
    return [
      {
        fn: (fn as string | null) ?? null,
        security: typeof security === 'string' && security.length < 25 ? security : undefined,
        params: safeParams,
        link: typeof link === 'string' ? link : null,
      },
    ]
  })
}
