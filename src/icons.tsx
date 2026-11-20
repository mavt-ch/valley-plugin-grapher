import { React } from './runtime'
import type { ReactElement, ReactNode } from 'react'

/** Inline stroke icons drawn with the host's React; monochrome through currentColor. */
export type IconProps = { className?: string }

export const Svg = ({ className, children }: IconProps & { children: ReactNode }): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const X = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M18 6L6 18M6 6l12 12" /></Svg>
)

export const Plus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 5v14M5 12h14" /></Svg>
)

export const Minus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 12h14" /></Svg>
)

/** Frame corners around the origin: back to the default view. */
export const Fit = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" /><circle cx="12" cy="12" r="1.5" /></Svg>
)

export const Eye = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Svg>
)

export const EyeOff = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.6 3.5M6.3 6.3A17.3 17.3 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></Svg>
)

export const Trash = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" /></Svg>
)

export const Slider = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 12h16" /><circle cx="9" cy="12" r="2.5" /></Svg>
)

/** Six dots: the handle that drags a row to a new place. */
export const Grip = (p: IconProps): ReactElement => (
  <svg className={p.className} width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle cx="15" cy="18" r="1.6" />
  </svg>
)

export const Warning = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 3.5L2.5 20h19z" /><path d="M12 10v4.5M12 17.5v.01" /></Svg>
)

export const ChevronDown = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M6 9l6 6 6-6" /></Svg>
)

export const Check = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Svg>
)

/** A small grid: a table of points. */
export const TableIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><rect x="4" y="5" width="16" height="14" rx="1.5" /><path d="M4 10h16M12 5v14" /></Svg>
)

/** An arrow down onto a tray: export the graph as a file. */
export const Download = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Svg>
)

export const Play = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none" /></Svg>
)

export const Pause = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M8.5 6v12M15.5 6v12" /></Svg>
)

/** A curve with a line touching it: a tangent. */
export const TangentIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 18c4 0 6-10 10-10s4 4 6 6" /><path d="M5 13l14-8" /></Svg>
)

/** Small arrows turning round: a vector field. */
export const FieldIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 9l4-4M9 5H6M9 5v3M19 15l-4 4M15 19h3M15 19v-3M15 5l4 4M19 9V6M19 9h-3M9 19l-4-4M5 15v3M5 15h3" /></Svg>
)

/** Nested rings: level curves. */
export const LevelsIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><ellipse cx="12" cy="12" rx="9" ry="6" /><ellipse cx="12" cy="12" rx="5" ry="3" /></Svg>
)

/** A curved sheet: a parametric surface. */
export const SurfaceIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3 9c3-3 6 3 9 0s6-3 9 0M3 9v6c3-3 6 3 9 0s6-3 9 0V9" /></Svg>
)

/** A sphere: a surface F(x, y, z) = 0. */
export const SphereIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="12" cy="12" r="8" /><ellipse cx="12" cy="12" rx="8" ry="3" /></Svg>
)

/** A plane touching a dome: a tangent plane. */
export const PlaneIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M5 18a7 7 0 0 1 14 0" /><path d="M3 11l6-3h12l-6 3z" /></Svg>
)

export const Search = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></Svg>
)

/** Chevrons pointing together: collapse all (the Files tree's glyph). */
export const CollapseAll = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M7 20l5-5 5 5M7 4l5 5 5-5" /></Svg>
)

/** Chevrons pointing apart: expand all (the Files tree's glyph). */
export const ExpandAll = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M7 15l5 5 5-5M7 9l5-5 5 5" /></Svg>
)

const SVG_ATTRIBUTES: Record<string, string> = { strokeWidth: 'stroke-width', strokeLinecap: 'stroke-linecap', strokeLinejoin: 'stroke-linejoin', fillRule: 'fill-rule' }

/** One of these icons as an SVG `data:` URI for a host-drawn tab icon: the same shapes, stroked in the icon colour. */
export function iconSource(Icon: (props: IconProps) => ReactElement): string {
  const shapes = (node: ReactNode): string => {
    if (Array.isArray(node)) return node.map(shapes).join('')
    if (!node || typeof node !== 'object' || !('type' in node)) return ''
    const element = node as ReactElement<Record<string, unknown>>
    if (typeof element.type !== 'string') return shapes(element.props.children as ReactNode)
    const attributes = Object.entries(element.props).filter(([key, value]) => key !== 'children' && (typeof value === 'string' || typeof value === 'number'))
      .map(([key, value]) => ` ${SVG_ATTRIBUTES[key] ?? key}="${String(value)}"`).join('')
    return `<${element.type}${attributes}/>`
  }
  const root = Icon({})
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${shapes((root.props as { children?: ReactNode }).children)}</svg>`
  return `data:image/svg+xml,${encodeURIComponent(markup)}`
}

export const Pencil = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></Svg>
)

/** Three dots: more actions. */
export const More = (p: IconProps): ReactElement => (
  <Svg {...p}><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></Svg>
)

/** Lucide `folder`: a closed folder, as in Map's favourites. */
export const FolderIcon = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></Svg>
)

/** Lucide `folder-open`: an open folder, as in Map's favourites. */
export const FolderOpen = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" /></Svg>
)

/** Material Icons `edit_note` (Google, Apache-2.0), filled: a folder with notes. */
export const NoteIcon = ({ className }: IconProps): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
    <path d="M3 10h11v2H3zm0-2h11V6H3zm0 8h7v-2H3zm15.01-3.13.71-.71a.996.996 0 0 1 1.41 0l.71.71c.39.39.39 1.02 0 1.41l-.71.71zm-.71.71-5.3 5.3V21h2.12l5.3-5.3z" />
  </svg>
)

export const FolderPlus = (p: IconProps): ReactElement => (
  <Svg {...p}><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2.5h8a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M12 10.5v6M9 13.5h6" /></Svg>
)

/* react-icons FaRegBookmark / FaBookmark (Font Awesome, 384 × 512), inlined: a plugin cannot bundle react-icons. The
   viewBox carries the margin the stroke icons have, so they weigh the same at one box size. */
export const Bookmark = ({ className }: IconProps): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="-64 -32 512 576" fill="currentColor" aria-hidden>
    <path d="M336 0H48C21.49 0 0 21.49 0 48v464l192-112 192 112V48c0-26.51-21.49-48-48-48zm0 428.43l-144-84-144 84V54a6 6 0 0 1 6-6h276c3.314 0 6 2.683 6 5.996V428.43z" />
  </svg>
)

export const BookmarkFilled = ({ className }: IconProps): ReactElement => (
  <svg className={className} width="1em" height="1em" viewBox="-64 -32 512 576" fill="currentColor" aria-hidden>
    <path d="M0 512V48C0 21.49 21.49 0 48 0h288c26.51 0 48 21.49 48 48v464L192 400 0 512z" />
  </svg>
)
