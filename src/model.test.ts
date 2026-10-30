import { describe, expect, it } from 'vitest'
import {
  type Bubble,
  type TimelineDoc,
  boundaries,
  bubblesAt,
  formatTime,
  group,
  groupError,
  level,
  maxLevel,
  moveBoundary,
  newDoc,
  removeBoundary,
  splitAt,
  ungroup,
} from './model'

function makeDoc(duration = 100): TimelineDoc {
  return newDoc({ kind: 'youtube', id: 'abc' }, duration, 'Test')
}

// Checks the tree invariants documented in model.ts.
function expectValid(doc: TimelineDoc): void {
  const check = (list: Bubble[], start: number, end: number): void => {
    expect(list[0]?.start).toBe(start)
    expect(list.at(-1)?.end).toBe(end)
    for (const [i, b] of list.entries()) {
      const next = list[i + 1]
      if (next != null) expect(b.end).toBe(next.start)
      expect(b.end).toBeGreaterThan(b.start)
      if (b.children.length > 0) {
        expect(b.children.length).toBeGreaterThanOrEqual(2)
        check(b.children, b.start, b.end)
      }
    }
  }
  check(doc.bubbles, 0, doc.duration)
}

function ids(doc: TimelineDoc, ...times: number[]): string[] {
  return times.map((t) => bubblesAt(doc, t).at(-1)?.id ?? '')
}

describe('splitAt', () => {
  it('splits the leaf under the playhead', () => {
    const doc = makeDoc()
    splitAt(doc, 30)
    splitAt(doc, 60)
    expect(boundaries(doc)).toEqual([30, 60])
    expectValid(doc)
  })

  it('refuses splits too close to an edge', () => {
    const doc = makeDoc()
    splitAt(doc, 30)
    expect(splitAt(doc, 30.1)).toBeNull()
    expect(splitAt(doc, 0)).toBeNull()
    expect(boundaries(doc)).toEqual([30])
  })

  it('splits inside a group without breaking it', () => {
    const doc = makeDoc()
    splitAt(doc, 50)
    const parent = group(doc, ids(doc, 10, 70))
    splitAt(doc, 20)
    expect(parent?.children).toHaveLength(3)
    expectValid(doc)
  })
})

describe('group and ungroup', () => {
  it('groups adjacent siblings', () => {
    const doc = makeDoc()
    splitAt(doc, 25)
    splitAt(doc, 50)
    splitAt(doc, 75)
    const parent = group(doc, ids(doc, 10, 30))
    expect(parent?.start).toBe(0)
    expect(parent?.end).toBe(50)
    expect(maxLevel(doc)).toBe(2)
    expectValid(doc)
  })

  it('rejects non-adjacent bubbles', () => {
    const doc = makeDoc()
    splitAt(doc, 25)
    splitAt(doc, 50)
    expect(groupError(doc, ids(doc, 10, 60))).toMatch(/next to each other/)
  })

  it('rejects bubbles that already fill their parent', () => {
    const doc = makeDoc()
    splitAt(doc, 50)
    group(doc, ids(doc, 10, 60))
    expect(groupError(doc, ids(doc, 10, 60))).toMatch(/fill their parent/)
  })

  it('ungroups back to the children', () => {
    const doc = makeDoc()
    splitAt(doc, 50)
    const parent = group(doc, ids(doc, 10, 60))
    expect(ungroup(doc, parent?.id ?? '')).toHaveLength(2)
    expect(maxLevel(doc)).toBe(1)
    expectValid(doc)
  })
})

describe('removeBoundary', () => {
  it('joins two leaves', () => {
    const doc = makeDoc()
    splitAt(doc, 30)
    splitAt(doc, 60)
    expect(removeBoundary(doc, 30)).toBe(true)
    expect(boundaries(doc)).toEqual([60])
    expectValid(doc)
  })

  it('joins the bubbles on both sides at every level', () => {
    const doc = makeDoc()
    for (const t of [20, 40, 60, 80]) splitAt(doc, t)
    group(doc, ids(doc, 10, 30))
    group(doc, ids(doc, 50, 70, 90))
    removeBoundary(doc, 40)
    expect(boundaries(doc)).toEqual([20, 60, 80])
    expect(doc.bubbles).toHaveLength(1)
    expect(doc.bubbles[0]?.children.map((c) => [c.start, c.end])).toEqual([
      [0, 20],
      [20, 60],
      [60, 80],
      [80, 100],
    ])
    expectValid(doc)
  })

  it('absorbs a leaf into a neighbouring group', () => {
    const doc = makeDoc()
    for (const t of [20, 40, 60]) splitAt(doc, t)
    group(doc, ids(doc, 30, 50, 70))
    removeBoundary(doc, 20)
    expect(doc.bubbles).toHaveLength(1)
    expect(doc.bubbles[0]?.children[0]?.start).toBe(0)
    expectValid(doc)
  })

  it('collapses a parent left with a single child', () => {
    const doc = makeDoc()
    splitAt(doc, 40)
    splitAt(doc, 70)
    const parent = group(doc, ids(doc, 10, 50))
    removeBoundary(doc, 40)
    expect(parent).not.toBeNull()
    expect(doc.bubbles.map(level)).toEqual([1, 1])
    expectValid(doc)
  })
})

describe('moveBoundary', () => {
  it('moves the timepoint at every level and clamps to neighbours', () => {
    const doc = makeDoc()
    splitAt(doc, 30)
    splitAt(doc, 60)
    group(doc, ids(doc, 10, 40))
    expect(moveBoundary(doc, 30, 45)).toBe(45)
    expect(moveBoundary(doc, 45, 90)).toBe(59.75)
    expectValid(doc)
  })
})

describe('formatTime', () => {
  it('formats minutes and hours', () => {
    expect(formatTime(5.25)).toBe('0:05.3')
    expect(formatTime(65, 0)).toBe('1:05')
    expect(formatTime(3725.5)).toBe('1:02:05.5')
  })
})
