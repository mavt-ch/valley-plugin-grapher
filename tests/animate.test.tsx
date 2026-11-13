import React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createMockValleyApi, loadPackageWasm, type PackageWasmModule } from '@valley/plugin-testkit'
import type { ValleyPluginManifest } from '@valley/plugin-sdk/types'
import * as plugin from '../src/index'
import { Sidebar } from '../src/Sidebar'
import { advance, FRAME_MS, snap, startMotion, SWEEP_SECONDS, type Motion } from '../src/animate'
import { DEFAULT_ANIMATION, normalizeDocument, type Animation } from '../src/model'
import { getStore } from '../src/store'
import manifest from '../manifest.json'
import config from '../config.json'

const declared = { ...manifest, ...config } as unknown as ValleyPluginManifest
const bounds = { min: -10, max: 10 }
let module: PackageWasmModule
let disposers: (() => Promise<void>)[] = []

beforeAll(async () => { module = await loadPackageWasm(process.cwd(), 'plot') })
afterEach(async () => {
  vi.useRealTimers()
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  await Promise.all(disposers.splice(0).map((dispose) => dispose()))
  document.head.querySelectorAll('style[id]').forEach((style) => style.remove())
})

const settings = (patch: Partial<Animation> = {}): Animation => ({ ...DEFAULT_ANIMATION, ...patch })
const move = (motion: Motion, animation: Animation, seconds: number): Motion => advance(motion, bounds, animation, seconds)

describe('slider motion', () => {
  it('moves forward one sweep per four seconds at 1× and wraps when looping', () => {
    const start = startMotion(0, bounds, settings())
    expect(move(start, settings(), 1).value).toBeCloseTo(20 / SWEEP_SECONDS)
    expect(move(start, settings({ speed: 2 }), 1).value).toBeCloseTo(10)
    const wrapped = move(start, settings(), 3)
    expect(wrapped.value).toBeCloseTo(-5)
    expect(wrapped.done).toBe(false)
  })

  it('stops at the end without loop and starts over from the other end when already there', () => {
    const once = settings({ loop: false })
    const end = move(startMotion(0, bounds, once), once, 3)
    expect(end).toMatchObject({ value: 10, done: true })
    expect(startMotion(10, bounds, once).value).toBe(-10)
    expect(startMotion(10, bounds, settings()).value).toBe(10)
  })

  it('runs backward and wraps to the top', () => {
    const back = settings({ direction: 'backward' })
    const start = startMotion(0, bounds, back)
    expect(start.heading).toBe(-1)
    expect(move(start, back, 1).value).toBeCloseTo(-5)
    expect(move(start, back, 3).value).toBeCloseTo(5)
    expect(startMotion(-10, bounds, settings({ direction: 'backward', loop: false })).value).toBe(10)
  })

  it('goes back and forth, turning at each end, and once there and back without loop', () => {
    const bounce = settings({ direction: 'bounce' })
    const turned = move(startMotion(5, bounds, bounce), bounce, 2)
    expect(turned).toMatchObject({ heading: -1, turns: 1, done: false })
    expect(turned.value).toBeCloseTo(5)
    expect(startMotion(10, bounds, bounce).heading).toBe(-1)
    const once = settings({ direction: 'bounce', loop: false })
    let motion = startMotion(-10, bounds, once)
    for (let k = 0; k < 20 && !motion.done; k++) motion = move(motion, once, 0.5)
    expect(motion).toMatchObject({ value: -10, turns: 2, done: true })
  })

  it('snaps to the slider step inside its bounds', () => {
    expect(snap(1.2345, bounds, 0.1)).toBeCloseTo(1.2)
    expect(snap(12, bounds, 0.1)).toBe(10)
    expect(snap(-3.3, { min: -10, max: 10 }, 2)).toBe(-4)
  })

  it('reads saved animation settings additively and falls back for older or broken files', () => {
    const document = normalizeDocument({ version: 1, mode: 'cartesian', sheets: { cartesian: [
      { id: 'a', text: 'a = 1', animation: { direction: 'bounce', speed: 2, loop: false } },
      { id: 'b', text: 'b = 1', animation: { direction: 'sideways', speed: 3 } },
      { id: 'c', text: 'c = 1' }
    ] } })
    const [a, b, c] = document.sheets.cartesian
    expect(a.animation).toEqual({ direction: 'bounce', speed: 2, loop: false })
    expect(b.animation).toEqual(DEFAULT_ANIMATION)
    expect(c.animation).toBeUndefined()
  })
})

describe('the play button', () => {
  async function mount() {
    const mock = createMockValleyApi({ manifest: declared, wasm: { modules: [module] } })
    disposers.push(plugin.register(mock.api))
    render(<Sidebar />)
    await screen.findByRole('button', { name: 'Play a' })
    // Let the first load settle, then count only the writes the animation causes.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)) })
    const writes = vi.spyOn(mock.api.data.files, 'writeTextGuarded')
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] })
    return { mock, writes }
  }

  const range = (): number => Number((screen.getByRole('slider', { name: 'Value of a' }) as HTMLInputElement).value)
  const wait = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

  it('plays forward at most 30 values a second, saves nothing while playing and once when paused, and keeps the value', async () => {
    const { mock, writes } = await mount()
    const frames = vi.spyOn(getStore(), 'updateRows')
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    expect(screen.getByRole('button', { name: 'Pause a' }).getAttribute('aria-pressed')).toBe('true')
    await wait(1000)
    const first = range()
    expect(first).toBeGreaterThan(5)
    expect(first).toBeLessThan(7)
    expect(frames.mock.calls.length).toBeLessThanOrEqual(31)
    expect(frames.mock.calls.every((call) => call[3]?.quiet === true)).toBe(true)
    await wait(500)
    expect(range()).toBeGreaterThan(first)
    expect(writes).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Pause a' }))
    const stopped = range()
    await wait(1000)
    expect(range()).toBe(stopped)
    expect(writes).toHaveBeenCalledTimes(1)
    expect(writes.mock.calls[0][1]).toContain(`"text": "a = ${stopped}"`)
    expect(await mock.api.data.files.readText('graphs.json')).toContain(`"text": "a = ${stopped}"`)
  })

  it('reverses, stops at the end without loop and saves its settings to the row', async () => {
    const { mock } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Animation of a' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Backward' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Loop' }))
    fireEvent.click(screen.getByRole('radio', { name: '4× speed' }))
    await wait(500)
    expect(await mock.api.data.files.readText('graphs.json')).toContain('"direction": "backward"')
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(250)
    expect(range()).toBeLessThan(0)
    await wait(1000)
    expect(range()).toBe(-10)
    expect(screen.getByRole('button', { name: 'Play a' })).toBeTruthy()
  })

  it('loops forward past the maximum back to the minimum', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Animation of a' }))
    fireEvent.click(screen.getByRole('radio', { name: '2× speed' }))
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(1000 + FRAME_MS)
    expect(range()).toBeLessThan(-5)
    expect(screen.getByRole('button', { name: 'Pause a' })).toBeTruthy()
  })

  it('stops when the document is hidden and saves once', async () => {
    const { writes } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(500)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    const stopped = range()
    expect(screen.getByRole('button', { name: 'Play a' })).toBeTruthy()
    await wait(1000)
    expect(range()).toBe(stopped)
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it('stops when another tab takes the focus or the sidebar edits another graph', async () => {
    const { mock } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(300)
    act(() => { mock.emitState({ activePluginTab: { pluginId: 'todo' } }) })
    expect(screen.getByRole('button', { name: 'Play a' })).toBeTruthy()
    const stopped = range()
    await wait(500)
    expect(range()).toBe(stopped)
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(300)
    act(() => { getStore().focus('g-other') })
    await wait(300)
    expect(screen.getByRole('button', { name: 'Play a' })).toBeTruthy()
  })

  it('stops when the range is dragged by hand', async () => {
    await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Play a' }))
    await wait(300)
    fireEvent.change(screen.getByRole('slider', { name: 'Value of a' }), { target: { value: '-3' } })
    await wait(500)
    expect(range()).toBe(-3)
    expect(screen.getByRole('button', { name: 'Play a' })).toBeTruthy()
  })
})
