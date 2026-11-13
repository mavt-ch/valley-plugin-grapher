/** The realm folder of profile icons, relative to `.valley/` (the storage area `metadata`). */
export const ICON_FOLDER = 'assets/icons/grapher-icon'
const MAX_ICON = 64_000
const MAX_TOTAL = 1_000_000

/** The part of the backend storage API the icon folder needs. */
export interface IconStorage {
  open(input: { area: 'metadata'; path: string; kind: 'directory'; mode: 'write' }): Promise<{ handle: string }>
  close(handle: string): Promise<void>
  mkdir(location: { handle: string; path: string }): Promise<void>
  stat(location: { handle: string; path: string }): Promise<unknown>
  list(location: { handle: string; path: string }): Promise<{ name: string; kind: string; size: number }[]>
  read(location: { handle: string; path: string }): Promise<string>
  write(location: { handle: string; path: string }, text: string): Promise<void>
}

const safeName = (name: string): boolean => /^[a-zA-Z0-9][a-zA-Z0-9 ._-]{0,63}$/.test(name)

/**
 * Seeds the bundled icons the folder lacks (a file already there, edited or not, is never overwritten), then returns every
 * SVG in it by file name without `.svg`, so an icon the user drops in appears at the next listing.
 */
export async function profileIcons(storage: IconStorage, defaults: Record<string, string>): Promise<{ icons: Record<string, string> }> {
  const grant = await storage.open({ area: 'metadata', path: ICON_FOLDER, kind: 'directory', mode: 'write' })
  const at = (path: string) => ({ handle: grant.handle, path })
  try {
    await storage.mkdir(at(''))
    for (const [name, svg] of Object.entries(defaults)) {
      if (!safeName(name) || svg.length > MAX_ICON || !svg.startsWith('<svg')) continue
      if (!await storage.stat(at(`${name}.svg`))) await storage.write(at(`${name}.svg`), svg)
    }
    const icons: Record<string, string> = {}
    let bytes = 0
    for (const entry of await storage.list(at(''))) {
      if (entry.kind !== 'file' || !/\.svg$/i.test(entry.name) || entry.size > MAX_ICON || bytes + entry.size > MAX_TOTAL) continue
      const name = entry.name.slice(0, -4)
      if (!safeName(name)) continue
      try {
        const svg = await storage.read(at(entry.name))
        if (svg.includes('<svg')) { icons[name] = svg; bytes += entry.size }
      } catch { /* an unreadable file is left out */ }
    }
    return { icons }
  } finally {
    await storage.close(grant.handle).catch(() => {})
  }
}
