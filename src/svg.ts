/**
 * A recording stand-in for the part of `CanvasRenderingContext2D` the plane painters use (paths, arcs, rectangles,
 * text, dashes, alpha, save/restore), writing SVG elements instead of pixels. The grid, the graphs, the markers and the
 * labels are painted by the same code as on screen, so the SVG export shows what the tab shows, as real vector paths and
 * text. Coordinates are CSS pixels; `setTransform` is ignored (the export has no device pixel ratio).
 */

/** Width of `text` in `font` (a canvas font string), in pixels. */
export type Measure = (font: string, text: string) => number

/** Turns any CSS colour into one SVG viewers read everywhere (`#rrggbb` or `rgba(…)`); identity where no canvas resolves it. */
export type Normalize = (color: string) => string

/** Fonts end in generic families, so the file reads outside Valley with whatever sans-serif the viewer has. */
const FALLBACK = 'system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif'

interface State {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  font: string
  textAlign: CanvasTextAlign
  textBaseline: CanvasTextBaseline
  lineJoin: CanvasLineJoin
  lineCap: CanvasLineCap
  dash: number[]
}

const number = (value: number): string => {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? '0' : String(rounded)
}

export const escapeXml = (text: string): string => text.replace(/[<>&"']/g, (char) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[char] ?? char)

/** A rough width for environments without a canvas: 0.6 em per character. */
export const estimateWidth: Measure = (font, text) => text.length * fontParts(font).size * 0.6

/** The weight, size and family of a canvas font string such as `600 13px Inter, sans-serif`. */
export function fontParts(font: string): { weight: string | null; size: number; family: string } {
  const match = /^\s*(?:(\S+)\s+)?(\d+(?:\.\d+)?)px\s+(.+)$/.exec(font)
  if (!match) return { weight: null, size: 11, family: FALLBACK }
  const family = match[3].trim()
  const generic = /(?:^|,)\s*(?:sans-serif|serif|monospace|system-ui)\s*$/i.test(family)
  return { weight: match[1] ?? null, size: Number(match[2]), family: generic ? family : `${family}, ${FALLBACK}` }
}

/** `rgba(r, g, b, a)` as `#rrggbb` plus an opacity, which every SVG viewer understands; other colours pass through. */
export function splitColor(color: string): { color: string; opacity: number } {
  const match = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(color.trim())
  if (!match) return { color, opacity: 1 }
  const hex = [match[1], match[2], match[3]].map((channel) => Math.max(0, Math.min(255, Math.round(Number(channel)))).toString(16).padStart(2, '0')).join('')
  const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number(match[4].slice(0, -1)) / 100 : Number(match[4])
  return { color: `#${hex}`, opacity: Number.isFinite(alpha) ? alpha : 1 }
}

export class SvgContext {
  private state: State = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1, font: '10px sans-serif', textAlign: 'start', textBaseline: 'alphabetic', lineJoin: 'miter', lineCap: 'butt', dash: [] }
  private readonly stack: State[] = []
  private readonly elements: string[] = []
  private path: string[] = []
  private open = false

  constructor(private readonly measure: Measure = estimateWidth, private readonly normalize: Normalize = (color) => color) {}

  get fillStyle(): string { return this.state.fillStyle }
  set fillStyle(value: string) { this.state.fillStyle = String(value) }
  get strokeStyle(): string { return this.state.strokeStyle }
  set strokeStyle(value: string) { this.state.strokeStyle = String(value) }
  get lineWidth(): number { return this.state.lineWidth }
  set lineWidth(value: number) { this.state.lineWidth = value }
  get globalAlpha(): number { return this.state.globalAlpha }
  set globalAlpha(value: number) { this.state.globalAlpha = value }
  get font(): string { return this.state.font }
  set font(value: string) { this.state.font = value }
  get textAlign(): CanvasTextAlign { return this.state.textAlign }
  set textAlign(value: CanvasTextAlign) { this.state.textAlign = value }
  get textBaseline(): CanvasTextBaseline { return this.state.textBaseline }
  set textBaseline(value: CanvasTextBaseline) { this.state.textBaseline = value }
  get lineJoin(): CanvasLineJoin { return this.state.lineJoin }
  set lineJoin(value: CanvasLineJoin) { this.state.lineJoin = value }
  get lineCap(): CanvasLineCap { return this.state.lineCap }
  set lineCap(value: CanvasLineCap) { this.state.lineCap = value }

  setTransform(): void {}
  save(): void { this.stack.push({ ...this.state, dash: [...this.state.dash] }) }
  restore(): void { this.state = this.stack.pop() ?? this.state }
  setLineDash(dash: number[]): void { this.state.dash = [...dash] }
  getLineDash(): number[] { return [...this.state.dash] }
  measureText(text: string): TextMetrics { return { width: this.measure(this.state.font, text) } as TextMetrics }

  beginPath(): void {
    this.path = []
    this.open = false
  }

  moveTo(x: number, y: number): void {
    this.path.push(`M${number(x)} ${number(y)}`)
    this.open = true
  }

  lineTo(x: number, y: number): void {
    this.path.push(`${this.open ? 'L' : 'M'}${number(x)} ${number(y)}`)
    this.open = true
  }

  closePath(): void {
    if (this.path.length) this.path.push('Z')
  }

  /** Canvas arc semantics: a line from the current point to the arc's start, then the arc, split into pieces under half a turn. */
  arc(x: number, y: number, radius: number, start: number, end: number, counterclockwise = false): void {
    const turn = Math.PI * 2
    let sweep = counterclockwise ? start - end : end - start
    if (sweep >= turn) sweep = turn
    else while (sweep < 0) sweep += turn
    const direction = counterclockwise ? -1 : 1
    const at = (angle: number): string => `${number(x + radius * Math.cos(angle))} ${number(y + radius * Math.sin(angle))}`
    this.path.push(`${this.open ? 'L' : 'M'}${at(start)}`)
    this.open = true
    const pieces = Math.max(1, Math.ceil(sweep / (Math.PI * 0.99)))
    for (let piece = 1; piece <= pieces; piece++) {
      this.path.push(`A${number(radius)} ${number(radius)} 0 0 ${counterclockwise ? 0 : 1} ${at(start + direction * sweep * (piece / pieces))}`)
    }
  }

  roundRect(x: number, y: number, width: number, height: number, radii: number | number[] = 0): void {
    const r = Math.max(0, Math.min(Array.isArray(radii) ? radii[0] ?? 0 : radii, width / 2, height / 2))
    const corner = (tx: number, ty: number): string => `A${number(r)} ${number(r)} 0 0 1 ${number(tx)} ${number(ty)}`
    this.path.push(`M${number(x + r)} ${number(y)}`, `H${number(x + width - r)}`, corner(x + width, y + r), `V${number(y + height - r)}`, corner(x + width - r, y + height), `H${number(x + r)}`, corner(x, y + height - r), `V${number(y + r)}`, corner(x + r, y), 'Z')
    this.open = true
  }

  rect(x: number, y: number, width: number, height: number): void {
    this.path.push(`M${number(x)} ${number(y)}`, `h${number(width)}`, `v${number(height)}`, `h${number(-width)}`, 'Z')
    this.open = true
  }

  fillRect(x: number, y: number, width: number, height: number): void {
    this.elements.push(`<rect x="${number(x)}" y="${number(y)}" width="${number(width)}" height="${number(height)}"${this.paint('fill', this.state.fillStyle)}/>`)
  }

  fill(): void {
    if (!this.path.length) return
    this.elements.push(`<path d="${this.path.join('')}"${this.paint('fill', this.state.fillStyle)}/>`)
  }

  stroke(): void {
    if (!this.path.length) return
    this.elements.push(`<path d="${this.path.join('')}" fill="none"${this.strokeAttributes()}/>`)
  }

  fillText(text: string, x: number, y: number): void {
    this.elements.push(`<text${this.textAttributes(x, y)}${this.paint('fill', this.state.fillStyle)}>${escapeXml(text)}</text>`)
  }

  strokeText(text: string, x: number, y: number): void {
    this.elements.push(`<text${this.textAttributes(x, y)} fill="none"${this.strokeAttributes()}>${escapeXml(text)}</text>`)
  }

  /** The finished document, `width` × `height` CSS pixels. */
  toSvg(width: number, height: number): string {
    const w = number(width)
    const h = number(height)
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">\n${this.elements.join('\n')}\n</svg>\n`
  }

  private paint(kind: 'fill' | 'stroke', color: string): string {
    const { color: value, opacity } = splitColor(this.normalize(color))
    const alpha = opacity * this.state.globalAlpha
    return ` ${kind}="${escapeXml(value)}"${alpha < 1 ? ` ${kind}-opacity="${Math.round(alpha * 1000) / 1000}"` : ''}`
  }

  private strokeAttributes(): string {
    const { lineWidth, lineJoin, lineCap, dash } = this.state
    return `${this.paint('stroke', this.state.strokeStyle)} stroke-width="${number(lineWidth)}"${lineJoin !== 'miter' ? ` stroke-linejoin="${lineJoin}"` : ''}${lineCap !== 'butt' ? ` stroke-linecap="${lineCap}"` : ''}${dash.length ? ` stroke-dasharray="${dash.map(number).join(' ')}"` : ''}`
  }

  private textAttributes(x: number, y: number): string {
    const { weight, size, family } = fontParts(this.state.font)
    const anchor = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' }[this.state.textAlign]
    const baseline = { top: 'text-before-edge', hanging: 'hanging', middle: 'central', alphabetic: 'alphabetic', ideographic: 'ideographic', bottom: 'text-after-edge' }[this.state.textBaseline]
    return ` x="${number(x)}" y="${number(y)}" font-family="${escapeXml(family)}" font-size="${number(size)}"${weight && weight !== 'normal' && weight !== '400' ? ` font-weight="${escapeXml(weight)}"` : ''}${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${baseline !== 'alphabetic' ? ` dominant-baseline="${baseline}"` : ''}`
  }
}
