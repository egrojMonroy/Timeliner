import { type Bubble, type TimelineDoc, boundaries, bubbleColor, formatTime, level, maxLevel } from './model'

export type Selection =
  | { kind: 'bubbles'; ids: string[] }
  | { kind: 'timepoint'; time: number }
  | { kind: 'marker'; id: string }
  | null

const SVG_NS = 'http://www.w3.org/2000/svg'
const LEVEL_H = 34
const MARKER_LANE = 28
const TOP_PAD = 6
const AXIS_H = 28
const LABEL_CHAR_W = 7
/** Room reserved above the leaves, so the first group doesn't make the timeline jump. */
const MIN_LEVELS = 2

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  if (text != null) node.textContent = text
  return node
}

// A bubble: a box rising from the baseline with rounded top corners.
function bubblePath(x0: number, x1: number, top: number, base: number): string {
  const r = Math.min(14, (x1 - x0) / 2, base - top)
  return [
    `M${x0},${base}`,
    `L${x0},${top + r}`,
    `Q${x0},${top} ${x0 + r},${top}`,
    `L${x1 - r},${top}`,
    `Q${x1},${top} ${x1},${top + r}`,
    `L${x1},${base}`,
    'Z',
  ].join(' ')
}

function fit(text: string, width: number): string {
  const max = Math.floor((width - 10) / LABEL_CHAR_W)
  if (max < 1) return ''
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`
}

// Picks a tick spacing that leaves at least ~70px between labels.
function tickStep(pxPerSecond: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600]
  return steps.find((s) => s * pxPerSecond >= 70) ?? 3600
}

export interface Layout {
  width: number
  height: number
  baseline: number
}

export function layout(doc: TimelineDoc, width: number): Layout {
  const baseline = MARKER_LANE + TOP_PAD + Math.max(MIN_LEVELS, maxLevel(doc)) * LEVEL_H
  return { width, height: baseline + AXIS_H, baseline }
}

/** Redraws the whole timeline. The playhead is moved separately by `placePlayhead`. */
export function renderTimeline(svg: SVGSVGElement, doc: TimelineDoc, sel: Selection, width: number): void {
  const { height, baseline } = layout(doc, width)
  const x = (t: number): number => (t / doc.duration) * width
  svg.setAttribute('width', String(width))
  svg.setAttribute('height', String(height))
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const selectedIds = new Set(sel?.kind === 'bubbles' ? sel.ids : [])
  const nodes: SVGElement[] = [
    el('rect', { x: 0, y: 0, width, height, class: 'tl-bg', 'data-kind': 'background' }),
  ]

  // Bubbles, tallest first so nested ones paint on top.
  const placed: { b: Bubble; depth: number; lvl: number }[] = []
  const collect = (list: Bubble[], depth: number): void => {
    for (const b of list) {
      placed.push({ b, depth, lvl: level(b) })
      collect(b.children, depth + 1)
    }
  }
  collect(doc.bubbles, 0)
  placed.sort((p, q) => q.lvl - p.lvl)

  for (const { b, depth, lvl } of placed) {
    const w = x(b.end) - x(b.start)
    const inset = Math.min(1 + depth * 2, w / 4)
    const x0 = x(b.start) + inset
    const x1 = x(b.end) - inset
    const top = baseline - lvl * LEVEL_H + 2
    const g = el('g', { class: selectedIds.has(b.id) ? 'bubble selected' : 'bubble', 'data-kind': 'bubble', 'data-id': b.id })
    g.append(el('path', { d: bubblePath(x0, x1, top, baseline), fill: bubbleColor(b) }))
    const label = fit(b.label, x1 - x0)
    if (label !== '') {
      g.append(el('text', { x: (x0 + x1) / 2, y: top + 16, 'text-anchor': 'middle' }, label))
    }
    if (b.annotation !== '') g.append(el('title', {}, `${b.label}\n${b.annotation}`.trim()))
    nodes.push(g)
  }

  // Axis with time ticks.
  const axis = el('g', { class: 'axis' })
  axis.append(el('line', { x1: 0, x2: width, y1: baseline, y2: baseline }))
  const step = tickStep(width / doc.duration)
  for (let t = 0; t <= doc.duration; t += step) {
    axis.append(el('line', { x1: x(t), x2: x(t), y1: baseline, y2: baseline + 5 }))
    const anchor = t === 0 ? 'start' : 'middle'
    axis.append(el('text', { x: x(t), y: baseline + 19, 'text-anchor': anchor }, formatTime(t, step < 1 ? 1 : 0)))
  }
  nodes.push(axis)

  // Timepoints: draggable handles on the baseline.
  for (const t of boundaries(doc)) {
    const selected = sel?.kind === 'timepoint' && sel.time === t
    const g = el('g', { class: selected ? 'timepoint selected' : 'timepoint', 'data-kind': 'timepoint', 'data-time': t })
    g.append(el('rect', { x: x(t) - 7, y: baseline - 10, width: 14, height: 20, class: 'hit' }))
    g.append(el('circle', { cx: x(t), cy: baseline, r: 4.5 }))
    g.append(el('title', {}, `Timepoint ${formatTime(t)}`))
    nodes.push(g)
  }

  // Markers: flags in the top lane with a guide line down to the baseline.
  for (const m of doc.markers) {
    const mx = x(m.time)
    const selected = sel?.kind === 'marker' && sel.id === m.id
    const g = el('g', { class: selected ? 'marker selected' : 'marker', 'data-kind': 'marker', 'data-id': m.id })
    g.append(el('line', { x1: mx, x2: mx, y1: 6, y2: baseline, class: 'guide' }))
    g.append(el('path', { d: `M${mx},4 L${mx + 11},9.5 L${mx},15 Z`, class: 'flag' }))
    g.append(el('rect', { x: mx - 5, y: 0, width: 16 + m.label.length * LABEL_CHAR_W, height: 20, class: 'hit' }))
    if (m.label !== '') g.append(el('text', { x: mx + 14, y: 14 }, m.label))
    g.append(el('title', {}, `${m.label !== '' ? m.label : 'Marker'} ${formatTime(m.time)}\n${m.annotation}`.trim()))
    nodes.push(g)
  }

  nodes.push(el('line', { id: 'playhead', x1: 0, x2: 0, y1: 0, y2: height }))
  svg.replaceChildren(...nodes)
}

export function placePlayhead(svg: SVGSVGElement, doc: TimelineDoc, t: number, width: number): number {
  const px = (t / doc.duration) * width
  const line = svg.querySelector('#playhead')
  line?.setAttribute('x1', String(px))
  line?.setAttribute('x2', String(px))
  return px
}

/** Converts a pointer position to a time on the timeline. */
export function timeAt(svg: SVGSVGElement, doc: TimelineDoc, clientX: number): number {
  const rect = svg.getBoundingClientRect()
  const t = ((clientX - rect.left) / rect.width) * doc.duration
  return Math.min(doc.duration, Math.max(0, t))
}
