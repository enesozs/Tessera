import { CommandBar } from './components/CommandBar'
import { StatusBar } from './components/StatusBar'
import { TopBar } from './components/TopBar'
import { Workspace } from './components/Workspace'

export function App() {
  return (
    <div className="flex h-full min-w-[720px] flex-col">
      <TopBar />
      <CommandBar />
      <main className="min-h-0 flex-1">
        <Workspace />
      </main>
      <StatusBar />
    </div>
  )
}
