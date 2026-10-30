import { h } from './dom'
import {
  type Bubble,
  type Marker,
  type TimelineDoc,
  bubbleColor,
  findBubble,
  formatTime,
  groupError,
  isLeaf,
  level,
  maxLevel,
  walk,
} from './model'
import type { Selection } from './view'

export interface InspectorActions {
  /** Call before the first change of an edit, so it can be undone in one step. */
  beginEdit(): void
  /** Call after changing the document in place. */
  edited(): void
  playRange(start: number, end: number): void
  group(ids: string[]): void
  ungroup(id: string): void
  removeTimepoint(time: number): void
  nudgeTimepoint(time: number, to: number): void
  removeMarker(id: string): void
  moveMarker(id: string, to: number): void
  currentTime(): number
}

// Text fields record one undo step per focus, then edit the doc on every keystroke.
function textField(
  label: string,
  value: string,
  onChange: (v: string) => void,
  actions: InspectorActions,
  multiline = false,
): HTMLElement {
  let fresh = true
  const props = {
    value,
    onfocus: () => {
      fresh = true
    },
    oninput: (e: Event) => {
      const target = e.target
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return
      if (fresh) actions.beginEdit()
      fresh = false
      onChange(target.value)
      actions.edited()
    },
  }
  const input = multiline ? h('textarea', { ...props, rows: 6 }) : h('input', { ...props, type: 'text' })
  return h('label', { className: 'field' }, h('span', {}, label), input)
}

function button(text: string, onClick: () => void, opts: { title?: string; disabled?: boolean; danger?: boolean } = {}) {
  return h(
    'button',
    { type: 'button', className: opts.danger === true ? 'danger' : '', title: opts.title, disabled: opts.disabled, onclick: onClick },
    text,
  )
}

function bubblePanel(b: Bubble, actions: InspectorActions): HTMLElement[] {
  // One undo step per color pick, however long the picker is dragged.
  let fresh = true
  const colorInput = h('input', {
    type: 'color',
    value: bubbleColor(b),
    oninput: (e: Event) => {
      if (!(e.target instanceof HTMLInputElement)) return
      if (fresh) actions.beginEdit()
      fresh = false
      b.color = e.target.value
      actions.edited()
    },
    onchange: () => {
      fresh = true
    },
  })
  const reset = button(
    'Auto',
    () => {
      actions.beginEdit()
      b.color = null
      colorInput.value = bubbleColor(b)
      actions.edited()
    },
    { title: 'Use the default color for this level' },
  )
  return [
    h('h2', {}, 'Bubble'),
    h('p', { className: 'meta' }, `${formatTime(b.start)} – ${formatTime(b.end)} · level ${level(b)}`),
    textField('Label', b.label, (v) => (b.label = v), actions),
    h('div', { className: 'field' }, h('span', {}, 'Color'), h('div', { className: 'row' }, colorInput, reset)),
    textField('Annotation', b.annotation, (v) => (b.annotation = v), actions, true),
    h(
      'div',
      { className: 'row' },
      button('▶ Play bubble', () => actions.playRange(b.start, b.end)),
      isLeaf(b) ? null : button('Ungroup', () => actions.ungroup(b.id), { title: 'Remove this bubble, keep its children (U)' }),
    ),
  ]
}

function markerPanel(m: Marker, actions: InspectorActions): HTMLElement[] {
  return [
    h('h2', {}, 'Marker'),
    h('p', { className: 'meta' }, `at ${formatTime(m.time)}`),
    textField('Label', m.label, (v) => (m.label = v), actions),
    textField('Annotation', m.annotation, (v) => (m.annotation = v), actions, true),
    h(
      'div',
      { className: 'row' },
      button('Move to playhead', () => actions.moveMarker(m.id, actions.currentTime())),
      button('Delete', () => actions.removeMarker(m.id), { danger: true }),
    ),
  ]
}

function timepointPanel(t: number, actions: InspectorActions): HTMLElement[] {
  return [
    h('h2', {}, 'Timepoint'),
    h('p', { className: 'meta' }, `at ${formatTime(t, 2)}`),
    h(
      'div',
      { className: 'row' },
      button('−0.1 s', () => actions.nudgeTimepoint(t, t - 0.1)),
      button('+0.1 s', () => actions.nudgeTimepoint(t, t + 0.1)),
      button('Move to playhead', () => actions.nudgeTimepoint(t, actions.currentTime())),
    ),
    h('p', { className: 'hint' }, 'Drag the handle on the timeline to move it. Deleting it joins the bubbles on both sides.'),
    h('div', { className: 'row' }, button('Delete timepoint', () => actions.removeTimepoint(t), { danger: true })),
  ]
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

function docPanel(doc: TimelineDoc, actions: InspectorActions): HTMLElement[] {
  const count = [...walk(doc.bubbles)].length
  return [
    h('h2', {}, 'Timeline'),
    h('p', { className: 'meta' }, [formatTime(doc.duration, 0), plural(count, 'bubble'), plural(maxLevel(doc), 'level'), plural(doc.markers.length, 'marker')].join(' · ')),
    textField('Description', doc.description, (v) => (doc.description = v), actions, true),
    h(
      'p',
      { className: 'hint' },
      'Press T while listening to cut the piece into bubbles. Select neighbours and press G to group them into a larger bubble.',
    ),
  ]
}

export function renderInspector(host: HTMLElement, doc: TimelineDoc, sel: Selection, actions: InspectorActions): void {
  let content: HTMLElement[]
  if (sel?.kind === 'bubbles' && sel.ids.length > 1) {
    const error = groupError(doc, sel.ids)
    content = [
      h('h2', {}, `${sel.ids.length} bubbles`),
      h('div', { className: 'row' }, button('Group', () => actions.group(sel.ids), { disabled: error != null, title: 'Group (G)' })),
      error != null ? h('p', { className: 'hint' }, error) : null,
    ].filter((n) => n != null)
  } else if (sel?.kind === 'bubbles') {
    const b = findBubble(doc, sel.ids[0] ?? '')
    content = b != null ? bubblePanel(b, actions) : docPanel(doc, actions)
  } else if (sel?.kind === 'marker') {
    const m = doc.markers.find((x) => x.id === sel.id)
    content = m != null ? markerPanel(m, actions) : docPanel(doc, actions)
  } else if (sel?.kind === 'timepoint') {
    content = timepointPanel(sel.time, actions)
  } else {
    content = docPanel(doc, actions)
  }
  host.replaceChildren(...content)
}
