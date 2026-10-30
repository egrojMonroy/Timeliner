import './style.css'
import { h } from './dom'
import { type InspectorActions, renderInspector } from './inspector'
import {
  type Bubble,
  type TimelineDoc,
  MIN_GAP,
  addMarker,
  boundaries,
  bubbleColor,
  bubblesAt,
  findBubble,
  formatTime,
  group,
  groupError,
  isLeaf,
  locate,
  moveBoundary,
  newDoc,
  removeBoundary,
  removeMarker,
  splitAt,
  ungroup,
  walk,
} from './model'
import type { MediaPlayer } from './player'
import {
  deleteLocal,
  docFromHash,
  downloadDoc,
  lastVideoId,
  listLocal,
  loadLocal,
  readDocFile,
  saveLocal,
  shareUrl,
} from './storage'
import { type Selection, placePlayhead, renderTimeline, timeAt } from './view'
import { createYouTubePlayer, parseYouTubeId } from './youtube'

// ---- Elements -----------------------------------------------------------------

function byId<T extends HTMLElement>(id: string, type: new () => T): T {
  const node = document.getElementById(id)
  if (!(node instanceof type)) throw new Error(`Missing #${id}`)
  return node
}

const ui = {
  home: byId('home-btn', HTMLButtonElement),
  loadForm: byId('load-form', HTMLFormElement),
  urlInput: byId('url-input', HTMLInputElement),
  importBtn: byId('import-btn', HTMLButtonElement),
  importFile: byId('import-file', HTMLInputElement),
  exportBtn: byId('export-btn', HTMLButtonElement),
  shareBtn: byId('share-btn', HTMLButtonElement),
  helpBtn: byId('help-btn', HTMLButtonElement),
  help: byId('help', HTMLDialogElement),
  welcome: byId('welcome', HTMLElement),
  recent: byId('recent', HTMLDivElement),
  workspace: byId('workspace', HTMLElement),
  player: byId('player', HTMLDivElement),
  title: byId('title-input', HTMLInputElement),
  now: byId('now', HTMLDivElement),
  inspector: byId('inspector', HTMLElement),
  play: byId('play-btn', HTMLButtonElement),
  clock: byId('clock', HTMLSpanElement),
  zoomLabel: byId('zoom-label', HTMLSpanElement),
  scroll: byId('timeline-scroll', HTMLDivElement),
  toast: byId('toast', HTMLDivElement),
}

const svgNode = document.getElementById('timeline')
if (!(svgNode instanceof SVGSVGElement)) throw new Error('Missing #timeline')
const svg = svgNode

function toolButton(action: string): HTMLButtonElement {
  const node = document.querySelector(`[data-action="${action}"]`)
  if (!(node instanceof HTMLButtonElement)) throw new Error(`Missing ${action} button`)
  return node
}

// ---- State --------------------------------------------------------------------

const HISTORY_LIMIT = 200
const ZOOM_STEP = 1.5
const ZOOM_MAX = 64

interface State {
  doc: TimelineDoc | null
  player: MediaPlayer | null
  sel: Selection
  zoom: number
  loop: boolean
  follow: boolean
  undo: TimelineDoc[]
  redo: TimelineDoc[]
  /** Bubble chain shown in the "now" panel, to skip redundant redraws. */
  nowKey: string
  /** Increments on every video load so stale loads can bail out. */
  loadToken: number
}

const state: State = {
  doc: null,
  player: null,
  sel: null,
  zoom: 1,
  loop: false,
  follow: true,
  undo: [],
  redo: [],
  nowKey: '',
  loadToken: 0,
}

function timelineWidth(): number {
  return Math.max(320, ui.scroll.clientWidth * state.zoom)
}

// ---- Feedback -----------------------------------------------------------------

let toastTimer = 0
function toast(message: string, error = false): void {
  ui.toast.textContent = message
  ui.toast.className = error ? 'toast show error' : 'toast show'
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (ui.toast.className = 'toast'), error ? 5000 : 2500)
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---- Rendering ----------------------------------------------------------------

let saveTimer = 0

/** Records the current document (or an earlier copy of it) so the next change can be undone. */
function checkpoint(snapshot = state.doc == null ? null : structuredClone(state.doc)): void {
  if (snapshot == null) return
  state.undo.push(snapshot)
  if (state.undo.length > HISTORY_LIMIT) state.undo.shift()
  state.redo = []
}

/** Redraws everything that depends on the document and schedules an autosave. */
function changed(opts: { inspector?: boolean } = {}): void {
  const doc = state.doc
  if (doc == null) return
  renderTimeline(svg, doc, state.sel, timelineWidth())
  if (opts.inspector !== false) renderInspector(ui.inspector, doc, state.sel, inspectorActions)
  state.nowKey = ''
  tick()
  updateToolbar()
  clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => saveLocal(doc), 400)
}

function select(sel: Selection): void {
  state.sel = sel
  changed()
}

function selectedBubbles(): Bubble[] {
  const doc = state.doc
  if (doc == null || state.sel?.kind !== 'bubbles') return []
  return state.sel.ids.map((id) => findBubble(doc, id)).filter((b) => b != null)
}

function updateToolbar(): void {
  const doc = state.doc
  const sel = state.sel
  const bubbles = selectedBubbles()
  const single = bubbles.length === 1 ? bubbles[0] : undefined
  toolButton('group').disabled = doc == null || sel?.kind !== 'bubbles' || groupError(doc, sel.ids) != null
  toolButton('ungroup').disabled = single == null || isLeaf(single)
  toolButton('delete').disabled = sel?.kind !== 'timepoint' && sel?.kind !== 'marker'
  toolButton('undo').disabled = state.undo.length === 0
  toolButton('redo').disabled = state.redo.length === 0
  toolButton('loop').setAttribute('aria-pressed', String(state.loop))
  toolButton('follow').setAttribute('aria-pressed', String(state.follow))
  ui.zoomLabel.textContent = `${Number(state.zoom.toFixed(1))}×`
  ui.exportBtn.disabled = doc == null
  ui.shareBtn.disabled = doc == null
}

function renderNow(doc: TimelineDoc, t: number): void {
  const chain = bubblesAt(doc, t)
  const recent = doc.markers.filter((m) => m.time <= t && t - m.time < 5)
  const key = [...chain, ...recent].map((x) => x.id).join()
  if (key === state.nowKey) return
  state.nowKey = key

  const items = chain.map((b) =>
    h(
      'div',
      { className: 'now-item' },
      h('span', { className: 'swatch', style: `background:${bubbleColor(b)}` }),
      h('strong', {}, b.label !== '' ? b.label : 'Untitled'),
      h('span', { className: 'meta' }, `${formatTime(b.start, 0)} – ${formatTime(b.end, 0)}`),
      b.annotation !== '' ? h('p', {}, b.annotation) : null,
    ),
  )
  const markers = recent.map((m) =>
    h(
      'div',
      { className: 'now-item' },
      h('span', { className: 'swatch', style: 'background:var(--muted)' }),
      h('strong', {}, `⚑ ${m.label !== '' ? m.label : 'Marker'}`),
      h('span', { className: 'meta' }, formatTime(m.time, 0)),
      m.annotation !== '' ? h('p', {}, m.annotation) : null,
    ),
  )
  const empty = chain.every((b) => b.label === '' && b.annotation === '') && markers.length === 0
  const hint = h('p', { className: 'empty' }, 'Labels and annotations of the bubbles under the playhead show here.')
  ui.now.replaceChildren(...items, ...markers, ...(empty ? [hint] : []))
}

// ---- Playback loop ----------------------------------------------------------------

function tick(): void {
  const { doc, player } = state
  if (doc == null || player == null) return
  const t = player.getTime()
  const playing = player.isPlaying()
  ui.clock.textContent = `${formatTime(t)} / ${formatTime(doc.duration)}`
  ui.play.textContent = playing ? '❚❚' : '▶'
  const px = placePlayhead(svg, doc, t, timelineWidth())
  renderNow(doc, t)

  // Loop the selected bubble.
  const loopBubble = state.loop ? selectedBubbles()[0] : undefined
  if (playing && loopBubble != null && t >= loopBubble.end - 0.05 && t < loopBubble.end + 0.5) {
    player.seek(loopBubble.start)
  }

  // Keep the playhead in view while playing.
  if (playing && state.follow && state.zoom > 1) {
    const left = ui.scroll.scrollLeft
    const width = ui.scroll.clientWidth
    if (px < left || px > left + width - 24) ui.scroll.scrollLeft = px - width * 0.1
  }
}

function frame(): void {
  tick()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

// ---- Actions ----------------------------------------------------------------------

function seek(t: number): void {
  state.player?.seek(t)
  tick()
}

function togglePlay(): void {
  const p = state.player
  if (p == null) return
  if (p.isPlaying()) p.pause()
  else p.play()
}

function addTimepoint(): void {
  const doc = state.doc
  const player = state.player
  if (doc == null || player == null) return
  const before = structuredClone(doc)
  if (splitAt(doc, player.getTime()) == null) {
    toast('Too close to an existing timepoint.')
    return
  }
  checkpoint(before)
  // Keep the selection; adding cuts while listening shouldn't disturb editing.
  changed()
}

function addMarkerAtPlayhead(): void {
  const doc = state.doc
  if (doc == null || state.player == null) return
  checkpoint()
  const m = addMarker(doc, state.player.getTime())
  select({ kind: 'marker', id: m.id })
}

function groupSelected(ids: string[]): void {
  const doc = state.doc
  if (doc == null) return
  const error = groupError(doc, ids)
  if (error != null) {
    toast(error)
    return
  }
  checkpoint()
  const parent = group(doc, ids)
  if (parent != null) select({ kind: 'bubbles', ids: [parent.id] })
}

function ungroupBubble(id: string): void {
  const doc = state.doc
  const b = doc == null ? null : findBubble(doc, id)
  if (doc == null || b == null || isLeaf(b)) return
  checkpoint()
  select({ kind: 'bubbles', ids: ungroup(doc, id) })
}

function deleteSelected(): void {
  const doc = state.doc
  const sel = state.sel
  if (doc == null || sel == null) return
  if (sel.kind === 'timepoint') {
    checkpoint()
    removeBoundary(doc, sel.time)
    select(null)
  } else if (sel.kind === 'marker') {
    checkpoint()
    removeMarker(doc, sel.id)
    select(null)
  } else if (sel.ids.length === 1 && sel.ids[0] != null) {
    ungroupBubble(sel.ids[0])
  }
}

function restore(from: TimelineDoc[], to: TimelineDoc[]): void {
  const doc = state.doc
  const prev = from.pop()
  if (doc == null || prev == null) return
  to.push(structuredClone(doc))
  state.doc = prev
  // Drop selections that no longer exist.
  const sel = state.sel
  if (sel?.kind === 'bubbles') {
    const ids = sel.ids.filter((id) => findBubble(prev, id) != null)
    state.sel = ids.length > 0 ? { kind: 'bubbles', ids } : null
  } else if (sel?.kind === 'marker' && !prev.markers.some((m) => m.id === sel.id)) state.sel = null
  else if (sel?.kind === 'timepoint' && !boundaries(prev).includes(sel.time)) state.sel = null
  ui.title.value = prev.title
  changed()
}

function jumpBoundary(dir: 1 | -1): void {
  const doc = state.doc
  const player = state.player
  if (doc == null || player == null) return
  const t = player.getTime()
  const points = [0, ...boundaries(doc), doc.duration]
  // A small tolerance so repeated presses move past the point just reached.
  const target = dir > 0 ? points.find((p) => p > t + 0.3) : points.findLast((p) => p < t - 0.3)
  if (target != null) seek(target)
}

function setZoom(zoom: number, anchorClientX?: number): void {
  const doc = state.doc
  const next = Math.min(ZOOM_MAX, Math.max(1, zoom))
  if (doc == null || next === state.zoom) return
  const rect = ui.scroll.getBoundingClientRect()
  const anchor = anchorClientX ?? rect.left + rect.width / 2
  const t = timeAt(svg, doc, anchor)
  state.zoom = next
  changed({ inspector: false })
  ui.scroll.scrollLeft = (t / doc.duration) * timelineWidth() - (anchor - rect.left)
}

function toggleLoop(): void {
  state.loop = !state.loop
  if (state.loop && selectedBubbles().length !== 1) toast('Select one bubble to loop it.')
  updateToolbar()
}

const inspectorActions: InspectorActions = {
  beginEdit: checkpoint,
  edited: () => changed({ inspector: false }),
  playRange: (start) => {
    seek(start)
    state.player?.play()
  },
  group: groupSelected,
  ungroup: ungroupBubble,
  removeTimepoint: (t) => {
    const doc = state.doc
    if (doc == null) return
    checkpoint()
    removeBoundary(doc, t)
    select(null)
  },
  nudgeTimepoint: (t, to) => {
    const doc = state.doc
    if (doc == null) return
    checkpoint()
    select({ kind: 'timepoint', time: moveBoundary(doc, t, to) })
  },
  removeMarker: (id) => {
    const doc = state.doc
    if (doc == null) return
    checkpoint()
    removeMarker(doc, id)
    select(null)
  },
  moveMarker: (id, to) => {
    const m = state.doc?.markers.find((x) => x.id === id)
    if (m == null) return
    checkpoint()
    m.time = to
    changed()
  },
  currentTime: () => state.player?.getTime() ?? 0,
}

// ---- Timeline pointer input ------------------------------------------------------

type Drag =
  | { kind: 'timepoint'; time: number; startX: number; moved: boolean }
  | { kind: 'marker'; id: string; startX: number; moved: boolean }

let drag: Drag | null = null
const DRAG_THRESHOLD = 3
const DOUBLE_CLICK_MS = 400

// The SVG is redrawn on every click, so native dblclick is unreliable; track it by hand.
let lastClick = { id: '', at: 0 }

function clickBubble(id: string, e: PointerEvent): void {
  const doc = state.doc
  if (doc == null) return
  const sel = state.sel
  const current = sel?.kind === 'bubbles' ? sel.ids : []

  if (e.ctrlKey || e.metaKey) {
    const ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    select(ids.length > 0 ? { kind: 'bubbles', ids } : null)
    return
  }
  // Shift selects the run of siblings between the last selected bubble and this one.
  const anchor = current.at(-1)
  if (e.shiftKey && anchor != null) {
    const a = locate(doc, anchor)
    const b = locate(doc, id)
    if (a != null && b != null && a.list === b.list) {
      const [lo, hi] = a.index < b.index ? [a.index, b.index] : [b.index, a.index]
      const ids = a.list.slice(lo, hi + 1).map((x) => x.id)
      // Keep the anchor last so further shift-clicks extend from it.
      select({ kind: 'bubbles', ids: [...ids.filter((x) => x !== anchor), anchor] })
      return
    }
  }
  const b = findBubble(doc, id)
  const double = lastClick.id === id && e.timeStamp - lastClick.at < DOUBLE_CLICK_MS
  lastClick = { id, at: e.timeStamp }
  select({ kind: 'bubbles', ids: [id] })
  if (b == null) return
  seek(b.start)
  if (double) state.player?.play()
}

svg.addEventListener('pointerdown', (e) => {
  const doc = state.doc
  if (doc == null || e.button !== 0) return
  const target = e.target instanceof Element ? e.target.closest('[data-kind]') : null
  const kind = target?.getAttribute('data-kind')
  if (target == null || kind == null) return

  if (kind === 'bubble') {
    clickBubble(target.getAttribute('data-id') ?? '', e)
  } else if (kind === 'timepoint') {
    const time = Number(target.getAttribute('data-time'))
    drag = { kind: 'timepoint', time, startX: e.clientX, moved: false }
    svg.setPointerCapture(e.pointerId)
    select({ kind: 'timepoint', time })
  } else if (kind === 'marker') {
    const id = target.getAttribute('data-id') ?? ''
    const m = doc.markers.find((x) => x.id === id)
    drag = { kind: 'marker', id, startX: e.clientX, moved: false }
    svg.setPointerCapture(e.pointerId)
    select({ kind: 'marker', id })
    if (m != null) seek(m.time)
  } else {
    select(null)
    seek(timeAt(svg, doc, e.clientX))
  }
})

svg.addEventListener('pointermove', (e) => {
  const doc = state.doc
  if (doc == null || drag == null) return
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.startX) < DRAG_THRESHOLD) return
    drag.moved = true
    checkpoint()
  }
  const t = timeAt(svg, doc, e.clientX)
  if (drag.kind === 'timepoint') {
    drag.time = moveBoundary(doc, drag.time, t)
    state.sel = { kind: 'timepoint', time: drag.time }
  } else {
    const id = drag.id
    const m = doc.markers.find((x) => x.id === id)
    if (m != null) m.time = t
  }
  changed({ inspector: false })
})

function endDrag(): void {
  const doc = state.doc
  if (drag == null || doc == null) return
  const wasMarker = drag.kind === 'marker' && drag.moved
  const moved = drag.moved
  drag = null
  if (wasMarker) doc.markers.sort((a, b) => a.time - b.time)
  if (moved) changed()
}
svg.addEventListener('pointerup', endDrag)
svg.addEventListener('pointercancel', endDrag)

ui.scroll.addEventListener(
  'wheel',
  (e) => {
    if (!(e.ctrlKey || e.metaKey)) return
    e.preventDefault()
    setZoom(e.deltaY < 0 ? state.zoom * 1.2 : state.zoom / 1.2, e.clientX)
  },
  { passive: false },
)

new ResizeObserver(() => {
  if (state.doc != null) changed({ inspector: false })
}).observe(ui.scroll)

// ---- Toolbar and keyboard ------------------------------------------------------------

const toolActions: Record<string, () => void> = {
  timepoint: addTimepoint,
  marker: addMarkerAtPlayhead,
  group: () => groupSelected(state.sel?.kind === 'bubbles' ? state.sel.ids : []),
  ungroup: () => {
    const b = selectedBubbles()[0]
    if (b != null) ungroupBubble(b.id)
  },
  delete: deleteSelected,
  loop: toggleLoop,
  follow: () => {
    state.follow = !state.follow
    updateToolbar()
  },
  'zoom-in': () => setZoom(state.zoom * ZOOM_STEP),
  'zoom-out': () => setZoom(state.zoom / ZOOM_STEP),
  undo: () => restore(state.undo, state.redo),
  redo: () => restore(state.redo, state.undo),
}

for (const [action, run] of Object.entries(toolActions)) toolButton(action).addEventListener('click', run)
ui.play.addEventListener('click', togglePlay)

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
}

document.addEventListener('keydown', (e) => {
  if (isTyping(e.target)) {
    if (e.key === 'Escape' && e.target instanceof HTMLElement) e.target.blur()
    return
  }
  if (ui.help.open || state.doc == null) {
    if (e.key === '?') ui.help.showModal()
    return
  }
  const mod = e.ctrlKey || e.metaKey
  const key = e.key.toLowerCase()

  if (mod && key === 'z') toolActions[e.shiftKey ? 'redo' : 'undo']?.()
  else if (mod && key === 'y') toolActions.redo?.()
  else if (mod) return
  else if (key === ' ') {
    // A focused button would also activate on Space.
    if (e.target instanceof HTMLButtonElement) e.target.blur()
    togglePlay()
  } else if (key === 't' || (key === 'enter' && !(e.target instanceof HTMLButtonElement))) addTimepoint()
  else if (key === 'm') addMarkerAtPlayhead()
  else if (key === 'g') toolActions.group?.()
  else if (key === 'u') toolActions.ungroup?.()
  else if (key === 'delete' || key === 'backspace') deleteSelected()
  else if (key === 'l') toggleLoop()
  else if (key === 'f') toolActions.follow?.()
  else if (key === '+' || key === '=') setZoom(state.zoom * ZOOM_STEP)
  else if (key === '-' || key === '_') setZoom(state.zoom / ZOOM_STEP)
  else if (key === 'arrowright' || key === 'arrowleft') {
    const dir = key === 'arrowright' ? 1 : -1
    if (e.shiftKey) seek(Math.max(0, (state.player?.getTime() ?? 0) + dir * 5))
    else jumpBoundary(dir)
  }
  else if (key === 'escape') select(null)
  else if (key === '?') ui.help.showModal()
  else return
  e.preventDefault()
})

// ---- Loading -------------------------------------------------------------------------

// Fits a saved timeline to the video's real length (YouTube can differ by a fraction of a second).
function fitDuration(doc: TimelineDoc, duration: number): void {
  const last = boundaries(doc).at(-1) ?? 0
  if (Math.abs(doc.duration - duration) < 0.001 || duration <= last + MIN_GAP) return
  for (const b of walk(doc.bubbles)) if (b.end === doc.duration) b.end = duration
  doc.duration = duration
  doc.markers = doc.markers.filter((m) => m.time <= duration)
}

async function openVideo(videoId: string, preset?: TimelineDoc): Promise<void> {
  const token = ++state.loadToken
  state.player?.destroy()
  state.player = null
  state.doc = null
  state.sel = null
  state.undo = []
  state.redo = []
  state.zoom = 1
  ui.welcome.hidden = true
  ui.workspace.hidden = false
  ui.urlInput.value = `https://youtu.be/${videoId}`
  ui.now.replaceChildren(h('p', { className: 'empty' }, 'Loading video…'))
  ui.inspector.replaceChildren()
  svg.replaceChildren()

  let player: MediaPlayer
  try {
    player = await createYouTubePlayer(ui.player, videoId, () => tick())
  } catch (e) {
    if (token !== state.loadToken) return
    toast(errorMessage(e), true)
    showWelcome()
    return
  }
  // A newer load started while this one was waiting.
  if (token !== state.loadToken) {
    player.destroy()
    return
  }

  const duration = player.getDuration()
  const doc = preset ?? loadLocal(videoId) ?? newDoc({ kind: 'youtube', id: videoId }, duration, player.getTitle())
  fitDuration(doc, duration)
  state.player = player
  state.doc = doc
  ui.title.value = doc.title
  ui.scroll.scrollLeft = 0
  changed()
  saveLocal(doc)
}

function showWelcome(): void {
  state.loadToken++
  state.player?.destroy()
  state.player = null
  state.doc = null
  ui.workspace.hidden = true
  ui.welcome.hidden = false
  updateToolbar()

  const saved = listLocal()
  if (saved.length === 0) {
    ui.recent.replaceChildren()
    return
  }
  ui.recent.className = 'recent'
  ui.recent.replaceChildren(
    h('h2', {}, 'Your timelines'),
    ...saved.map((s) => {
      const remove = h(
        'button',
        {
          type: 'button',
          className: 'remove',
          title: 'Delete this timeline',
          'aria-label': `Delete ${s.title}`,
          onclick: (e: Event) => {
            e.stopPropagation()
            if (!confirm(`Delete “${s.title !== '' ? s.title : 'Untitled'}”? This cannot be undone.`)) return
            deleteLocal(s.videoId)
            showWelcome()
          },
        },
        '×',
      )
      return h(
        'button',
        { type: 'button', className: 'recent-item', onclick: () => void openVideo(s.videoId) },
        h('img', { src: `https://i.ytimg.com/vi/${s.videoId}/mqdefault.jpg`, alt: '', loading: 'lazy' }),
        h('span', {}, s.title !== '' ? s.title : 'Untitled'),
        remove,
      )
    }),
  )
}

ui.loadForm.addEventListener('submit', (e) => {
  e.preventDefault()
  const id = parseYouTubeId(ui.urlInput.value)
  if (id == null) {
    toast('That does not look like a YouTube link.', true)
    return
  }
  void openVideo(id)
})

ui.home.addEventListener('click', showWelcome)

// One undo step per title edit, like the inspector's text fields.
let titleFresh = true
ui.title.addEventListener('focus', () => {
  titleFresh = true
})
ui.title.addEventListener('input', () => {
  const doc = state.doc
  if (doc == null) return
  if (titleFresh) checkpoint()
  titleFresh = false
  doc.title = ui.title.value
  changed({ inspector: false })
})

ui.exportBtn.addEventListener('click', () => {
  if (state.doc != null) downloadDoc(state.doc)
})

ui.importBtn.addEventListener('click', () => ui.importFile.click())
ui.importFile.addEventListener('change', async () => {
  const file = ui.importFile.files?.[0]
  ui.importFile.value = ''
  if (file == null) return
  try {
    const doc = await readDocFile(file)
    if (!confirmReplace(doc)) return
    await openVideo(doc.source.id, doc)
    toast(`Opened “${doc.title}”.`)
  } catch (e) {
    toast(errorMessage(e), true)
  }
})

ui.shareBtn.addEventListener('click', async () => {
  const doc = state.doc
  if (doc == null) return
  try {
    const url = await shareUrl(doc)
    await navigator.clipboard.writeText(url)
    toast('Link copied. Anyone with it can open a copy of this timeline.')
  } catch (e) {
    toast(`Could not copy the link: ${errorMessage(e)}`, true)
  }
})

ui.helpBtn.addEventListener('click', () => ui.help.showModal())

/** Asks before an incoming timeline replaces a different saved one for the same video. */
function confirmReplace(incoming: TimelineDoc): boolean {
  const existing = loadLocal(incoming.source.id)
  if (existing == null || JSON.stringify(existing) === JSON.stringify(incoming)) return true
  return confirm(
    `You already have a timeline for this video (“${existing.title}”). Replace it with “${incoming.title}”?`,
  )
}

async function start(): Promise<void> {
  try {
    const shared = await docFromHash()
    if (shared != null) {
      history.replaceState(null, '', location.pathname + location.search)
      await openVideo(shared.source.id, confirmReplace(shared) ? shared : undefined)
      return
    }
  } catch {
    toast('The shared link is damaged and could not be opened.', true)
  }
  const last = lastVideoId()
  if (last != null && loadLocal(last) != null) await openVideo(last)
  else showWelcome()
}

void start()
