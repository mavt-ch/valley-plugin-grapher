import { React, api } from './runtime'
import type { ReactElement } from 'react'
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

const SHAPES = new Set(['g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon'])
const SHAPE_ATTRIBUTES: Record<string, string> = { d: 'd', cx: 'cx', cy: 'cy', r: 'r', rx: 'rx', ry: 'ry', x: 'x', y: 'y', x1: 'x1', y1: 'y1', x2: 'x2', y2: 'y2', width: 'width', height: 'height', points: 'points', transform: 'transform', opacity: 'opacity', 'fill-rule': 'fillRule', 'clip-rule': 'clipRule' }

/** An icon of the folder as a plain SVG element (for menu entries): its shapes only, stroked in the current colour. */
export function profileIconElement(name: string): ReactElement | null {
  const svg = registry().icons[name] ?? PROFILE_ICONS[name]
  if (!svg || typeof DOMParser === 'undefined') return null
  const root = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  if (root.localName !== 'svg') return null
  let key = 0
  const shapes = (parent: Element): ReactElement[] => Array.from(parent.children).filter((child) => SHAPES.has(child.localName)).map((child) => {
    const props: Record<string, string | number> = { key: key++ }
    for (const attribute of Array.from(child.attributes)) {
      const prop = SHAPE_ATTRIBUTES[attribute.name]
      if (prop && !/url\s*\(|javascript:/i.test(attribute.value)) props[prop] = attribute.value
    }
    return React.createElement(child.localName, props, ...shapes(child))
  })
  return React.createElement('svg', {
    width: '1em', height: '1em', viewBox: root.getAttribute('viewBox') ?? '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: root.getAttribute('stroke-width') ?? 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true
  }, ...shapes(root))
}
