import { useEffect } from 'react'
import { AlertWatcher, Toaster } from './components/Alerts'
import { CommandBar } from './components/CommandBar'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { Workspace } from './components/Workspace'
import { decode, type WorkspaceSpec } from './lib/share'
import { useToasts } from './state/toasts'
import { POPOUT_PANE, useWorkspace } from './state/workspace'

/** Open a shared workspace link (?ws=…) as a new tab, then tidy the address bar. */
function useSharedWorkspace() {
  useEffect(() => {
    const url = new URL(window.location.href)
    const raw = url.searchParams.get('ws')
    if (!raw) return
    const spec = decode<WorkspaceSpec>(raw)
    if (spec) {
      useWorkspace.getState().importWorkspace(spec)
      useToasts.getState().push(`Opened shared workspace "${spec.name}"`)
    } else useToasts.getState().push('That share link is damaged')
    url.searchParams.delete('ws')
    window.history.replaceState(null, '', url)
  }, [])
}

export function App() {
  useSharedWorkspace()
  return (
    <div className="flex h-full min-w-[720px] flex-col">
      <TopBar />
      <CommandBar />
      <main className="min-h-0 flex-1">
        <Workspace />
      </main>
      <StatusBar />
      {!POPOUT_PANE && <AlertWatcher />}
      <Toaster />
    </div>
  )
}
