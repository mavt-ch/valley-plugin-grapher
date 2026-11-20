/**
 * ```grapher``` code block — a live graph in a note.
 *
 *   ```grapher
 *   view: polar             (cartesian | polar | parametric | 3d | cylindrical | spherical | complex | complex-3d)
 *   units: pi               (decimal | pi: the axis labels of a flat view)
 *   height: 320             (pixels, 160 to 800)
 *   center: 0, 0            (flat views: the point in the middle)
 *   span: 12                (flat views: the units across the width)
 *   range: 6                (3D views: half the edge of the cube)
 *   r = 1 + cos(θ)
 *   r = 2 sin(3θ) ; 0 .. 2π ; blue
 *   a = 2 ; slider 0 .. 5 ; step 0.5
 *   ```
 *
 * Every other line is one expression, written as in the sidebar. Options follow it after `;`: a range (`0 .. 4π`, a
 * second one for a surface over two coordinates, each optionally named as in `t = 0 .. 4π`), a palette colour or
 * `#rrggbb`, `slider min .. max`, `step n`, `hidden`, `floor`, `flow` and `connect`. Sliders under the graph move and
 * play; nothing in the block is saved, and Open in Grapher copies it into a new graph tab.
 */
import type { FC, ReactElement } from 'react'
import { DEFAULT_PALETTE, paletteRef } from '@valley/plugin-sdk/palette'
import codeBlockExamples from './codeBlockExamples.json'
import { React, api } from './runtime'
import { uiText } from './localization'
import { DEFAULT_ANIMATION, createRow, filled, type AxisUnits, type Mode, type Row } from './model'
import { MODES, viewOf, type PlaneView, type SpaceView } from './views'
import { getStore, useGrapher } from './store'
import { GraphCanvas, homeView } from './GraphView'
import { SpaceCanvas } from './Space'
import { SliderAnimator, snap, startMotion } from './animate'
import { parseBound, sliderText } from './Sidebar'
import { Pause, Play } from './icons'
import type { Size } from './draw'
import type { RowAnalysis, Viewport } from './engine'

export const FENCE_LANGUAGE = 'grapher'
export const FENCE_HEIGHT = { min: 160, max: 800, default: 320 } as const

export interface FenceProblem {
  key: string
  args: Record<string, string | number>
}

export interface GrapherFenceSpec {
  mode: Mode
  units: AxisUnits
  height: number
  center: readonly [number, number] | null
  span: number | null
  range: number | null
  rows: Row[]
  /** The block's line (1-based) of each row, for its error. */
  lines: number[]
  problems: FenceProblem[]
}

const VIEW_NAMES: Record<string, Mode> = {
  ...Object.fromEntries(MODES.map((mode) => [mode.toLowerCase(), mode])),
  '2d': 'cartesian',
  '3d': 'space',
  'complex-3d': 'complexSpace',
  complex3d: 'complexSpace',
  'complex-space': 'complexSpace'
}

const PALETTE_IDS = new Set(DEFAULT_PALETTE.map((color) => color.id))
const SETTING = /^\s*(view|units|height|center|span|range)\s*:\s*(.*?)\s*$/i
const RANGE = /^(?:[\p{L}][\p{L}\p{N}_]*\s*[=:]\s*)?(.+?)\s*(?:\.\.|…)\s*(.+)$/u
const SLIDER = /^slider\s*:?\s*(.+?)\s*(?:\.\.|…)\s*(.+)$/i
const STEP = /^step\s*:?\s*(.+)$/i
const COLOR = /^(?:colou?r\s*:?\s*)?(#[0-9a-f]{6}|#[0-9a-f]{3}|[a-z][a-z-]*)$/i
const FLAGS = ['hidden', 'floor', 'flow', 'connect'] as const

const positive = (text: string): number | null => {
  const value = parseBound(text)
  return value !== null && value > 0 ? value : null
}

/** The block's settings and rows; anything it does not understand becomes a problem shown under the graph. */
export function parseGrapherFence(code: string): GrapherFenceSpec {
  const problems: FenceProblem[] = []
  const settings: Record<string, string> = {}
  const rows: Row[] = []
  const lines: number[] = []
  code.split(/\r?\n/).forEach((source, index) => {
    const line = index + 1
    if (!source.trim()) return
    const setting = SETTING.exec(source)
    if (setting) {
      settings[setting[1].toLowerCase()] = setting[2]
      return
    }
    const [text, ...options] = source.split(';')
    const row = createRow(rows, text.trim())
    const ranges: [string, string][] = []
    for (const raw of options) {
      const option = raw.trim()
      if (!option) continue
      const lower = option.toLowerCase()
      const slider = SLIDER.exec(option)
      const step = STEP.exec(option)
      const range = RANGE.exec(option)
      const color = COLOR.exec(option)
      if ((FLAGS as readonly string[]).includes(lower)) {
        Object.assign(row, { [lower]: true })
      } else if (slider) {
        const min = parseBound(slider[1])
        const max = parseBound(slider[2])
        if (min === null || max === null || !(min < max)) problems.push({ key: 'fence.badSlider', args: { line } })
        else row.slider = { ...row.slider, min, max }
      } else if (step) {
        const value = positive(step[1])
        if (value === null) problems.push({ key: 'fence.badStep', args: { line } })
        else row.slider = { ...row.slider, step: value }
      } else if (range) {
        if (ranges.length < 2) ranges.push([range[1].trim(), range[2].trim()])
        else problems.push({ key: 'fence.unknownOption', args: { line, option } })
      } else if (color && (color[1].startsWith('#') || PALETTE_IDS.has(color[1].toLowerCase()))) {
        row.color = color[1].startsWith('#') ? color[1].toLowerCase() : paletteRef(color[1].toLowerCase())
      } else {
        problems.push({ key: 'fence.unknownOption', args: { line, option } })
      }
    }
    if (ranges[0]) [row.from, row.to] = ranges[0]
    if (ranges[1]) [row.from2, row.to2] = ranges[1]
    rows.push(row)
    lines.push(line)
  })

  let mode: Mode = 'cartesian'
  if (settings.view !== undefined) {
    const named = VIEW_NAMES[settings.view.toLowerCase().replace(/\s+/g, '-')]
    if (named) mode = named
    else problems.push({ key: 'fence.unknownView', args: { value: settings.view } })
  }
  const view = viewOf(mode)
  let units: AxisUnits = view.canvas === 'plane' ? view.units : 'decimal'
  if (settings.units !== undefined) {
    const value = settings.units.toLowerCase()
    if (value === 'pi' || value === 'π') units = 'pi'
    else if (value === 'decimal') units = 'decimal'
    else problems.push({ key: 'fence.unknownUnits', args: { value: settings.units } })
  }
  let height: number = FENCE_HEIGHT.default
  if (settings.height !== undefined) {
    const value = positive(settings.height.replace(/px$/i, ''))
    if (value === null) problems.push({ key: 'fence.badSetting', args: { key: 'height' } })
    else height = Math.round(Math.max(FENCE_HEIGHT.min, Math.min(FENCE_HEIGHT.max, value)))
  }
  let center: [number, number] | null = null
  if (settings.center !== undefined) {
    const parts = settings.center.split(/\s*[,;]\s*|\s+/).filter(Boolean).map(parseBound)
    if (parts.length === 2 && parts[0] !== null && parts[1] !== null) center = [parts[0], parts[1]]
    else problems.push({ key: 'fence.badSetting', args: { key: 'center' } })
  }
  const span = settings.span === undefined ? null : positive(settings.span)
  if (settings.span !== undefined && span === null) problems.push({ key: 'fence.badSetting', args: { key: 'span' } })
  const range = settings.range === undefined ? null : positive(settings.range)
  if (settings.range !== undefined && range === null) problems.push({ key: 'fence.badSetting', args: { key: 'range' } })
  if (!rows.some(filled)) problems.push({ key: 'fence.empty', args: {} })
  return { mode, units, height, center, span, range, rows, lines, problems }
}

/** The view a flat block opens on: its centre, and its span across the width (else the view's own home). */
export function fenceHome(view: PlaneView, spec: Pick<GrapherFenceSpec, 'center' | 'span'>, size: Size): Viewport {
  const home = spec.span !== null && size.width > 0 ? { cx: 0, cy: 0, scale: size.width / spec.span } : homeView(view, size)
  return spec.center ? { ...home, cx: spec.center[0], cy: spec.center[1] } : home
}

/** A slider of the block: the play button, the bar and the value; it changes the block's rows only, never a file. */
const FenceSlider = ({ row, name, value, change }: { row: Row; name: string; value: number; change: (text: string) => void }): ReactElement => {
  const { step } = row.slider
  const min = Math.min(row.slider.min, value)
  const max = Math.max(row.slider.max, value)
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0
  const ref = React.useRef<HTMLDivElement>(null)
  const [playing, setPlaying] = React.useState(false)
  const run = React.useRef<SliderAnimator | null>(null)
  const live = React.useRef(change)
  live.current = change
  const stop = React.useCallback((): void => {
    run.current?.stop()
    run.current = null
    setPlaying(false)
  }, [])
  React.useEffect(() => stop, [stop])
  const play = (): void => {
    const view = ref.current?.ownerDocument.defaultView
    if (!view || run.current) return
    const bounds = { min: row.slider.min, max: row.slider.max }
    const settings = row.animation ?? DEFAULT_ANIMATION
    const animator = new SliderAnimator(view, startMotion(value, bounds, settings), {
      bounds: () => bounds,
      settings: () => settings,
      frame: (next) => live.current(sliderText(name, snap(next, bounds, step), step)),
      end: stop
    })
    run.current = animator
    setPlaying(true)
    animator.start()
  }
  return (
    <div className="grapher-fence-slider" ref={ref}>
      <button type="button" className="grapher-play" aria-pressed={playing} aria-label={uiText(playing ? 'slider.pause' : 'slider.play', { name })} title={uiText(playing ? 'slider.pause' : 'slider.play', { name })} onClick={playing ? stop : play}>
        {playing ? <Pause /> : <Play />}
      </button>
      <span className="grapher-fence-slider-name">{name}</span>
      <input
        className="grapher-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ ['--slider-fill' as string]: `${fill}%` }}
        aria-label={uiText('slider.value', { name })}
        onChange={(event) => {
          stop()
          change(sliderText(name, Number(event.target.value), step))
        }}
      />
      <span className="grapher-fence-slider-value">{sliderText(name, value, step).slice(name.length + 3)}</span>
    </div>
  )
}

let fences = 0

export const GrapherFence: FC<{ code: string }> = ({ code }) => {
  const spec = React.useMemo(() => parseGrapherFence(code), [code])
  const { loaded, engine, problems } = useGrapher()
  const [rows, setRows] = React.useState(spec.rows)
  React.useEffect(() => setRows(spec.rows), [spec])
  const slot = React.useMemo(() => `#fence-${++fences}`, [])
  const { mode, units } = spec
  const view = viewOf(mode)
  const analyses = React.useMemo((): RowAnalysis[] => (engine ? engine.analyze(mode, rows) : []), [engine, mode, rows])
  const plane = React.useMemo(() => (view.canvas === 'plane' ? { home: (size: Size) => fenceHome(view, spec, size) } : undefined), [view, spec])
  const space = React.useMemo((): SpaceView | null => (view.canvas === 'space' ? (spec.range !== null ? { ...view, homeRange: spec.range } : view) : null), [view, spec])
  const setText = (id: string, text: string): void => setRows((current) => current.map((row) => (row.id === id && row.text !== text ? { ...row, text } : row)))
  const open = (): void => {
    const id = getStore().createGraphWith(mode, spec.rows, units)
    api.workspace.openMainTab({ instanceId: id, title: uiText('graph.title'), newTab: true })
  }
  const engineProblem = problems.find((problem) => problem.key === 'problem.engine')
  const messages = [
    ...spec.problems.map((problem) => uiText(problem.key, problem.args)),
    ...rows.flatMap((_, index) => {
      const error = analyses[index]?.kind === 'error' ? analyses[index].error : undefined
      return error ? [uiText('fence.line', { line: spec.lines[index], message: uiText(error.key, { name: error.param }) })] : []
    })
  ]
  const Icon = view.icon
  return (
    <>
      {engineProblem ? <p role="alert" className="grapher-fence-message">{uiText('problem.engine', { message: engineProblem.message })}</p> : null}
      <div className="grapher-fence-stage" style={{ height: spec.height }}>
        {space
          ? <SpaceCanvas key={mode} view={space} rows={rows} engine={engine} graph={slot} slot={slot} units={units} embedded />
          : <GraphCanvas key={mode} view={view as PlaneView} units={units} rows={rows} analyses={analyses} engine={engine} graph={slot} slot={slot} embedded={plane} />}
      </div>
      {rows.map((row, index) => {
        const analysis = analyses[index]
        if (analysis?.kind !== 'param' || !analysis.slider || analysis.name === undefined || analysis.value === undefined || row.hidden) return null
        return <FenceSlider key={row.id} row={row} name={analysis.name} value={analysis.value} change={(text) => setText(row.id, text)} />
      })}
      {messages.map((message, index) => <p key={index} className="grapher-fence-message">{message}</p>)}
      <div className="grapher-fence-foot">
        <span className="grapher-fence-view"><Icon className="grapher-fence-view-icon" />{uiText(`mode.${mode}`)}</span>
        <button type="button" className="grapher-fence-open" disabled={!loaded} onClick={open}>{uiText('fence.open')}</button>
      </div>
    </>
  )
}

/** Register the ```grapher``` fence; returns the unregister fn. */
export function registerGrapherFence(): () => void {
  return api.markdown.registerCodeBlockRenderer(FENCE_LANGUAGE, (code, el) => {
    el.classList.add('grapher-fence')
    return api.ui.renderReact(el, <GrapherFence code={code} />)
  }, { examples: codeBlockExamples.grapher })
}
