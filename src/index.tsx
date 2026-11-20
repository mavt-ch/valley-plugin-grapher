/**
 * Grapher — a function plotter with four coordinate systems.
 *   - `grapher.sidebar` (left_sidebar): the coordinate-system switch in the panel header, then the active
 *     sheet's expressions with sliders, ranges and errors.
 *   - `grapher.graph` (main_workspace): one tab per graph; each tab keeps its own view and sheets, and the sidebar
 *     edits the focused one.
 *   - ```grapher``` code blocks: a live graph with its sliders in a note (`src/fence.tsx`).
 *   - Properties segment `grapher.reference` on graph tabs: every feature with its syntax and examples, searchable.
 * Parsing, analysis and sampling run in the Rust kernel (`src/wasm`, module `plot`); both views share one store.
 */
import { METADATA_PANEL_SEGMENT_V1, type ValleyPluginApi, type ValleyPluginModule } from '@valley/plugin-sdk'
import { React, initRuntime } from './runtime'
import { initLocalization } from './localization'
import { injectStyles } from './styles'
import { Sidebar, openNewGraph } from './Sidebar'
import { GraphTab } from './GraphView'
import { REFERENCE_SEGMENT, Reference } from './Reference'
import { EDIT_NOTE_ICON, NOTES_SEGMENT, Notes } from './Notes'
import { getStore } from './store'
import { COLOR_ORDER_SETTING, SettingsView } from './Settings'
import { setColorOrder } from './model'
import { provideGraphSurface } from './exporting'
import { provideGraphDetails } from './details'
import { registerGrapherFence } from './fence'

export function register(api: ValleyPluginApi): () => Promise<void> {
  initLocalization(api)
  initRuntime(api)
  const disposeStyles = injectStyles()
  api.registerView('grapher.sidebar', Sidebar)
  api.registerView('grapher.graph', GraphTab)
  api.registerView('grapher.settings', SettingsView)
  // New rows take their colours in the order chosen in Settings → Grapher.
  setColorOrder(api.settings.get()[COLOR_ORDER_SETTING])
  const offColors = api.settings.subscribe(() => setColorOrder(api.settings.get()[COLOR_ORDER_SETTING]))
  const store = getStore()
  // + in the tab strip of a Grapher tab opens another graph with its own sheets, on the focused graph's view.
  const offNewTab = api.workspace.registerNewTabHandler(({ paneId }) => openNewGraph(store.graph(store.getSnapshot().active).mode, paneId))
  // The graph tab's three-dot menu offers the export of what it shows.
  const offSurface = provideGraphSurface(api, store)
  // Info rows of the focused graph tab in Properties.
  const offDetails = provideGraphDetails(api, store)
  // ```grapher``` blocks draw a live graph in notes.
  const offFence = registerGrapherFence()
  // Beside it, the graph's Markdown notes.
  const offNotes = api.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: NOTES_SEGMENT, label: 'Notes', labelKey: 'notes.tab', icon: EDIT_NOTE_ICON, pluginSurfaces: ['main_workspace'],
    render: (context) => React.createElement(Notes, { tab: context.tab?.instanceId ?? context.subject?.instanceId })
  })
  // The reference is Grapher's tab in the right sidebar's Properties while a graph tab is focused.
  const offReference = api.interop.extensions.provide(METADATA_PANEL_SEGMENT_V1, {
    id: REFERENCE_SEGMENT, label: 'Reference', labelKey: 'ref.tab', icon: 'sticky-note', pluginSurfaces: ['main_workspace'],
    render: (context) => React.createElement(Reference, { tab: context.tab?.instanceId ?? context.subject?.instanceId })
  })
  let disposal: Promise<void> | undefined
  return () => {
    if (disposal) return disposal
    offNewTab()
    offSurface()
    offReference()
    offDetails()
    offFence()
    offNotes()
    offColors()
    disposal = store.flush().catch(() => {}).finally(() => {
      store.dispose()
      disposeStyles()
    })
    return disposal
  }
}

const plugin: ValleyPluginModule = { register }
export default plugin
