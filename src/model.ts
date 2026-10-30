// Timeline data model.
//
// A timeline is a tree of bubbles. The top-level list covers [0, duration]
// without gaps. Every bubble with children has at least two, and its children
// cover exactly its own span. Leaves are the smallest bubbles; the boundaries
// between leaves are the timepoints.

export interface Bubble {
  id: string
  start: number
  end: number
  label: string
  /** CSS color, or null to use the default color for the bubble's level. */
  color: string | null
  annotation: string
  children: Bubble[]
}

export interface Marker {
  id: string
  time: number
  label: string
  annotation: string
}

export interface YouTubeSource {
  kind: 'youtube'
  id: string
}

export type MediaSource = YouTubeSource

export interface TimelineDoc {
  version: 1
  title: string
  description: string
  source: MediaSource
  duration: number
  bubbles: Bubble[]
  markers: Marker[]
}

/** Smallest bubble length, in seconds, that edits may create. */
export const MIN_GAP = 0.25

export function newId(): string {
  return crypto.randomUUID()
}

export function newBubble(start: number, end: number, children: Bubble[] = []): Bubble {
  return { id: newId(), start, end, label: '', color: null, annotation: '', children }
}

export function newDoc(source: MediaSource, duration: number, title: string): TimelineDoc {
  return {
    version: 1,
    title,
    description: '',
    source,
    duration,
    bubbles: [newBubble(0, duration)],
    markers: [],
  }
}

export function isLeaf(b: Bubble): boolean {
  return b.children.length === 0
}

/** Height of a bubble in the tree: leaves are level 1. */
export function level(b: Bubble): number {
  let max = 0
  for (const c of b.children) max = Math.max(max, level(c))
  return max + 1
}

export function maxLevel(doc: TimelineDoc): number {
  let max = 0
  for (const b of doc.bubbles) max = Math.max(max, level(b))
  return max
}

export function* walk(list: Bubble[]): Generator<Bubble> {
  for (const b of list) {
    yield b
    yield* walk(b.children)
  }
}

export function leaves(doc: TimelineDoc): Bubble[] {
  return [...walk(doc.bubbles)].filter(isLeaf)
}

/** Sorted interior timepoints (every bubble edge except 0 and duration). */
export function boundaries(doc: TimelineDoc): number[] {
  return leaves(doc)
    .slice(1)
    .map((l) => l.start)
}

export function findBubble(doc: TimelineDoc, id: string): Bubble | null {
  for (const b of walk(doc.bubbles)) if (b.id === id) return b
  return null
}

interface Location {
  list: Bubble[]
  index: number
  /** Null when the list is the top level. */
  parent: Bubble | null
}

export function locate(doc: TimelineDoc, id: string): Location | null {
  const search = (list: Bubble[], parent: Bubble | null): Location | null => {
    for (const [i, b] of list.entries()) {
      if (b.id === id) return { list, index: i, parent }
      const found = search(b.children, b)
      if (found != null) return found
    }
    return null
  }
  return search(doc.bubbles, null)
}

function containing(list: Bubble[], t: number): Bubble | null {
  for (const [i, b] of list.entries()) {
    const last = i === list.length - 1
    if (t >= b.start && (t < b.end || (last && t <= b.end))) return b
  }
  return null
}

/** Bubbles that contain time t, from the top level down to the leaf. */
export function bubblesAt(doc: TimelineDoc, t: number): Bubble[] {
  const chain: Bubble[] = []
  let list = doc.bubbles
  for (;;) {
    const b = containing(list, t)
    if (b == null) return chain
    chain.push(b)
    list = b.children
  }
}

/** Splits the leaf at time t into two leaves. Returns the new right-hand leaf. */
export function splitAt(doc: TimelineDoc, t: number): Bubble | null {
  const leaf = bubblesAt(doc, t).at(-1)
  if (leaf == null) return null
  if (t - leaf.start < MIN_GAP || leaf.end - t < MIN_GAP) return null
  const loc = locate(doc, leaf.id)
  if (loc == null) return null
  const right = newBubble(t, leaf.end)
  leaf.end = t
  loc.list.splice(loc.index + 1, 0, right)
  return right
}

// Joins two adjacent bubbles into one, merging their facing descendants too.
function merge(a: Bubble, b: Bubble): Bubble {
  const label = a.label !== '' ? a.label : b.label
  const annotation = [a.annotation, b.annotation].filter((s) => s !== '').join('\n\n')
  const last = a.children.at(-1)
  const [first, ...rest] = b.children
  if (last == null) {
    if (first == null) return { ...a, label, annotation, end: b.end }
    // A leaf next to a parent is absorbed into the parent's facing child.
    return { ...b, start: a.start, children: [merge(a, first), ...rest] }
  }
  const inner = first != null ? merge(last, first) : merge(last, b)
  return {
    ...a,
    label,
    annotation,
    end: b.end,
    children: [...a.children.slice(0, -1), inner, ...(first != null ? rest : [])],
  }
}

/** Removes the timepoint at t, joining the bubbles on either side at every level. */
export function removeBoundary(doc: TimelineDoc, t: number): boolean {
  const removeIn = (list: Bubble[]): boolean => {
    for (const [i, b] of list.entries()) {
      const next = list[i + 1]
      if (b.end === t && next != null) {
        list.splice(i, 2, merge(b, next))
        return true
      }
      if (b.start < t && t < b.end) {
        const removed = removeIn(b.children)
        // A bubble left with one child is the same span twice; drop the inner one.
        const only = b.children.length === 1 ? b.children[0] : undefined
        if (only != null) b.children = only.children
        return removed
      }
    }
    return false
  }
  return removeIn(doc.bubbles)
}

/** Allowed range for moving the timepoint at t, keeping MIN_GAP to its neighbours. */
export function boundaryRange(doc: TimelineDoc, t: number): [number, number] | null {
  const all = boundaries(doc)
  const i = all.indexOf(t)
  if (i === -1) return null
  const prev = all[i - 1] ?? 0
  const next = all[i + 1] ?? doc.duration
  return [prev + MIN_GAP, next - MIN_GAP]
}

/** Moves the timepoint at `from` to `to`, clamped to its neighbours. Returns the new time. */
export function moveBoundary(doc: TimelineDoc, from: number, to: number): number {
  const range = boundaryRange(doc, from)
  if (range == null) return from
  const clamped = Math.min(range[1], Math.max(range[0], to))
  for (const b of walk(doc.bubbles)) {
    if (b.start === from) b.start = clamped
    if (b.end === from) b.end = clamped
  }
  return clamped
}

interface Span {
  list: Bubble[]
  from: number
  count: number
}

// Finds the run of adjacent siblings that `ids` names, or explains why there is none.
function siblingSpan(doc: TimelineDoc, ids: string[]): Span | string {
  if (ids.length < 2) return 'Select at least two bubbles to group.'
  const locs = ids.map((id) => locate(doc, id)).filter((l) => l != null)
  const first = locs[0]
  if (first == null || locs.length !== ids.length || locs.some((l) => l.list !== first.list)) {
    return 'Grouped bubbles must sit at the same level, under the same parent.'
  }
  const indices = locs.map((l) => l.index).sort((x, y) => x - y)
  const from = indices[0] ?? 0
  if (indices.some((idx, k) => idx !== from + k)) return 'Grouped bubbles must be next to each other.'
  if (first.parent != null && ids.length === first.list.length) {
    return 'These bubbles already fill their parent.'
  }
  return { list: first.list, from, count: ids.length }
}

/** Why a set of bubbles cannot be grouped, or null if it can. */
export function groupError(doc: TimelineDoc, ids: string[]): string | null {
  const span = siblingSpan(doc, ids)
  return typeof span === 'string' ? span : null
}

/** Wraps adjacent sibling bubbles in a new parent bubble. Returns the parent. */
export function group(doc: TimelineDoc, ids: string[]): Bubble | null {
  const span = siblingSpan(doc, ids)
  if (typeof span === 'string') return null
  const members = span.list.slice(span.from, span.from + span.count)
  const first = members[0]
  const last = members.at(-1)
  if (first == null || last == null) return null
  const parent = newBubble(first.start, last.end, members)
  span.list.splice(span.from, span.count, parent)
  return parent
}

/** Removes a parent bubble and keeps its children. Returns the children's ids. */
export function ungroup(doc: TimelineDoc, id: string): string[] {
  const loc = locate(doc, id)
  const b = loc?.list[loc.index]
  if (loc == null || b == null || isLeaf(b)) return []
  loc.list.splice(loc.index, 1, ...b.children)
  return b.children.map((c) => c.id)
}

export function addMarker(doc: TimelineDoc, time: number): Marker {
  const marker: Marker = { id: newId(), time, label: '', annotation: '' }
  doc.markers.push(marker)
  doc.markers.sort((a, b) => a.time - b.time)
  return marker
}

export function removeMarker(doc: TimelineDoc, id: string): void {
  doc.markers = doc.markers.filter((m) => m.id !== id)
}

/** Default bubble colors by level, lowest level first. */
export const LEVEL_COLORS = ['#8ecae6', '#ffb703', '#90be6d', '#f28482', '#b8a1e3', '#f6bd60']

export function bubbleColor(b: Bubble): string {
  return b.color ?? LEVEL_COLORS[(level(b) - 1) % LEVEL_COLORS.length] ?? '#ccc'
}

/** Formats seconds as m:ss.s (or h:mm:ss.s). */
export function formatTime(seconds: number, decimals = 1): string {
  const s = Math.max(0, seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = (s % 60).toFixed(decimals).padStart(decimals > 0 ? 3 + decimals : 2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}
