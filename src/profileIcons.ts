import { api } from './runtime'
import { CubeIcon, FunctionIcon, GridIcon, SigmaIcon, SphereIcon2, WaveIcon, iconSource } from './icons'
import { VIEWS } from './views'

/** The icon folder as the user sees it in the realm. */
export const PROFILE_ICON_FOLDER = '.valley/assets/icons/grapher-icon'

const EXTRAS = { function: FunctionIcon, wave: WaveIcon, grid: GridIcon, sigma: SigmaIcon, cube: CubeIcon, sphere: SphereIcon2 }

/** The bundled icons as SVG files: the eight view icons by view id, then a few neutral ones. */
export function defaultIcons(): Record<string, string> {
  const svg = (source: string): string => decodeURIComponent(source.slice('data:image/svg+xml,'.length))
  return Object.fromEntries([...VIEWS.map((view) => [view.id, svg(iconSource(view.icon))]), ...Object.entries(EXTRAS).map(([name, icon]) => [name, svg(iconSource(icon))])])
}

interface Registry { icons: Record<string, string>; listeners: Set<() => void>; pending: Promise<void> | null; loaded: boolean }

function registry(): Registry {
  return api.runtime.getOrCreate('grapher.profileIcons', () => ({ icons: {}, listeners: new Set<() => void>(), pending: null, loaded: false }) as Registry)
}

/** Lists the folder again (seeding the bundled icons it lacks); an SVG the user added appears without a rebuild. */
export function refreshProfileIcons(): Promise<void> {
  const current = registry()
  if (current.pending) return current.pending
  current.pending = api.backend.call<{ icons: Record<string, string> }>('icons', { defaults: defaultIcons() }).then(
    (result) => { current.icons = result?.icons ?? {} },
    () => {}
  ).finally(() => {
    current.pending = null
    current.loaded = true
    current.listeners.forEach((listener) => listener())
  })
  return current.pending
}

export function profileIconSvgs(): Record<string, string> {
  const current = registry()
  if (!current.loaded && !current.pending) void refreshProfileIcons()
  return current.icons
}

export function subscribeProfileIcons(listener: () => void): () => void {
  const current = registry()
  current.listeners.add(listener)
  return () => { current.listeners.delete(listener) }
}

/** An icon's SVG as a `data:` URI (for a CSS mask in the sidebar and the host-drawn tab icon), or null when it is missing. */
export function profileIconSource(name: string | undefined): string | null {
  const svg = name ? registry().icons[name] : undefined
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null
}
