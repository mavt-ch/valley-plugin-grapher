import type { Animation } from './model'

/** Seconds for one sweep from the slider's minimum to its maximum at 1×. */
export const SWEEP_SECONDS = 4

/** The frame budget: at most one value per 1/30 s. Every value re-analyses the sheet and resamples the graph, so animation
 * frames in between are skipped (the next value is computed from the time that passed, never queued). */
export const FRAME_MS = 1000 / 30

/** A stall longer than this (a busy frame, a throttled window) moves the value by this much time only. */
const MAX_STEP_SECONDS = 0.25

/** Where a playing slider is: its value (unrounded), which way it moves and how many ends it has turned at. */
export interface Motion {
  value: number
  heading: 1 | -1
  turns: number
  done: boolean
}

export interface Bounds {
  min: number
  max: number
}

/** The motion a press of play starts: a run that would end at once (forward at the maximum without loop) starts from the
 * other end, and back and forth heads away from the end it stands on. */
export function startMotion(value: number, { min, max }: Bounds, settings: Animation): Motion {
  let start = Math.max(min, Math.min(max, value))
  let heading: 1 | -1 = settings.direction === 'backward' ? -1 : 1
  if (settings.direction === 'forward' && !settings.loop && start >= max) start = min
  if (settings.direction === 'backward' && !settings.loop && start <= min) start = max
  if (settings.direction === 'bounce' && start >= max) heading = -1
  return { value: start, heading, turns: 0, done: false }
}

/** The motion `seconds` later. Forward and backward wrap to the other end when looping and stop at the end otherwise; back
 * and forth turns at each end, and without loop stops at the second end it reaches (there and back). */
export function advance(motion: Motion, { min, max }: Bounds, settings: Animation, seconds: number): Motion {
  const span = max - min
  if (!(span > 0) || motion.done) return { ...motion, done: true }
  let value = motion.value + motion.heading * span * settings.speed * seconds / SWEEP_SECONDS
  let { heading, turns } = motion
  if (settings.direction === 'bounce') {
    for (;;) {
      const edge = value > max ? max : value < min ? min : null
      if (edge === null) break
      turns += 1
      if (!settings.loop && turns >= 2) return { value: edge, heading, turns, done: true }
      value = 2 * edge - value
      heading = edge === max ? -1 : 1
    }
    return { value, heading, turns, done: false }
  }
  if (value <= max && value >= min) return { value, heading, turns, done: false }
  if (!settings.loop) return { value: value > max ? max : min, heading, turns: turns + 1, done: true }
  return { value: min + ((((value - min) % span) + span) % span), heading, turns: turns + 1, done: false }
}

/** The value on the slider's step grid from its minimum, inside its bounds. */
export function snap(value: number, { min, max }: Bounds, step: number): number {
  const snapped = step > 0 ? min + Math.round((value - min) / step) * step : value
  return Math.max(min, Math.min(max, snapped))
}

export interface AnimatorHandlers {
  /** Bounds and settings are read on every frame, so editing them while playing takes effect at once. */
  bounds: () => Bounds
  settings: () => Animation
  frame: (value: number) => void
  /** The run ended by itself (no loop) or because the document was hidden. */
  end: () => void
}

/**
 * Plays one slider on `requestAnimationFrame` of the window that renders it (the sidebar's, not the plugin's hidden
 * controller window), at most one value per {@link FRAME_MS}, and stops when that document is hidden.
 */
export class SliderAnimator {
  private frameId: number | null = null
  private last = 0
  private motion: Motion
  private readonly onVisibility = (): void => {
    if (this.view.document.visibilityState === 'hidden') this.finish()
  }

  constructor(private readonly view: Window, start: Motion, private readonly handlers: AnimatorHandlers) {
    this.motion = start
  }

  start(): void {
    if (this.view.document.visibilityState === 'hidden') {
      this.handlers.end()
      return
    }
    this.view.document.addEventListener('visibilitychange', this.onVisibility)
    this.view.addEventListener('pagehide', this.onVisibility)
    this.last = this.view.performance.now()
    this.frameId = this.view.requestAnimationFrame(this.tick)
  }

  /** Stops without calling `end` (the caller stops it). */
  stop(): void {
    if (this.frameId !== null) this.view.cancelAnimationFrame(this.frameId)
    this.frameId = null
    this.view.document.removeEventListener('visibilitychange', this.onVisibility)
    this.view.removeEventListener('pagehide', this.onVisibility)
  }

  get running(): boolean {
    return this.frameId !== null
  }

  private finish(): void {
    if (!this.running) return
    this.stop()
    this.handlers.end()
  }

  private readonly tick = (now: number): void => {
    this.frameId = null
    const elapsed = now - this.last
    if (elapsed < FRAME_MS - 1) {
      this.frameId = this.view.requestAnimationFrame(this.tick)
      return
    }
    this.last = now
    this.motion = advance(this.motion, this.handlers.bounds(), this.handlers.settings(), Math.min(MAX_STEP_SECONDS, elapsed / 1000))
    this.handlers.frame(this.motion.value)
    if (this.motion.done) {
      this.stop()
      this.handlers.end()
      return
    }
    this.frameId = this.view.requestAnimationFrame(this.tick)
  }
}
