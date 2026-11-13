import { api } from './runtime'
import { PROFILE_ICONS } from './profileIconSet'

/** The icon folder as the user sees it in the realm. */
export const PROFILE_ICON_FOLDER = '.valley/assets/icons/grapher-icon'

/** The bundled icons as SVG files: everyday objects and animals (`src/profileIconSet.ts`). */
export function defaultIcons(): Record<string, string> {
  return { ...PROFILE_ICONS }
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
  const svg = name ? registry().icons[name] ?? PROFILE_ICONS[name] : undefined
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : null
}

/** The icon names the folder holds, once it has been listed (null before). */
export function availableProfileIcons(): ReadonlySet<string> | null {
  const current = registry()
  return current.loaded && Object.keys(current.icons).length ? new Set(Object.keys(current.icons)) : null
}
