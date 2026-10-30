import type { Bubble, Marker, TimelineDoc } from './model'

const DOC_PREFIX = 'timeliner:doc:'
const LAST_KEY = 'timeliner:last'

// ---- Validation -------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v)
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

function num(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Expected a number.')
  return v
}

function parseBubble(v: unknown): Bubble {
  if (!isRecord(v)) throw new Error('Bubble is not an object.')
  const children = Array.isArray(v.children) ? v.children.map(parseBubble) : []
  return {
    id: str(v.id, crypto.randomUUID()),
    start: num(v.start),
    end: num(v.end),
    label: str(v.label),
    color: typeof v.color === 'string' ? v.color : null,
    annotation: str(v.annotation),
    children,
  }
}

function parseMarker(v: unknown): Marker {
  if (!isRecord(v)) throw new Error('Marker is not an object.')
  return {
    id: str(v.id, crypto.randomUUID()),
    time: num(v.time),
    label: str(v.label),
    annotation: str(v.annotation),
  }
}

/** Parses an untrusted value into a timeline, or throws with a readable message. */
export function parseDoc(v: unknown): TimelineDoc {
  if (!isRecord(v) || v.version !== 1) throw new Error('This is not a Timeliner file.')
  const source = v.source
  if (!isRecord(source) || source.kind !== 'youtube' || typeof source.id !== 'string') {
    throw new Error('The timeline has no YouTube video.')
  }
  if (!Array.isArray(v.bubbles) || v.bubbles.length === 0) throw new Error('The timeline has no bubbles.')
  return {
    version: 1,
    title: str(v.title),
    description: str(v.description),
    source: { kind: 'youtube', id: source.id },
    duration: num(v.duration),
    bubbles: v.bubbles.map(parseBubble),
    markers: Array.isArray(v.markers) ? v.markers.map(parseMarker) : [],
  }
}

// ---- Local autosave ----------------------------------------------------------
// Storage can throw (private mode, quota), so every access is guarded.

export function saveLocal(doc: TimelineDoc): void {
  try {
    localStorage.setItem(DOC_PREFIX + doc.source.id, JSON.stringify(doc))
    localStorage.setItem(LAST_KEY, doc.source.id)
  } catch {
    // Autosave is best effort.
  }
}

export function loadLocal(videoId: string): TimelineDoc | null {
  try {
    const raw = localStorage.getItem(DOC_PREFIX + videoId)
    return raw == null ? null : parseDoc(JSON.parse(raw))
  } catch {
    return null
  }
}

export function lastVideoId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

export interface SavedSummary {
  videoId: string
  title: string
}

export function listLocal(): SavedSummary[] {
  const out: SavedSummary[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key == null || !key.startsWith(DOC_PREFIX)) continue
      const doc = loadLocal(key.slice(DOC_PREFIX.length))
      if (doc != null) out.push({ videoId: doc.source.id, title: doc.title })
    }
  } catch {
    // Ignore unreadable storage.
  }
  return out.sort((a, b) => a.title.localeCompare(b.title))
}

export function deleteLocal(videoId: string): void {
  try {
    localStorage.removeItem(DOC_PREFIX + videoId)
  } catch {
    // Nothing to clean up.
  }
}

// ---- Files ------------------------------------------------------------------

function slug(text: string): string {
  const s = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return s !== '' ? s : 'timeline'
}

export function downloadDoc(doc: TimelineDoc): void {
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${slug(doc.title)}.timeline.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function readDocFile(file: File): Promise<TimelineDoc> {
  let json: unknown
  try {
    json = JSON.parse(await file.text())
  } catch {
    throw new Error('That file is not valid JSON.')
  }
  return parseDoc(json)
}

// ---- Share links ------------------------------------------------------------
// The whole timeline travels in the URL hash, deflated and base64url-encoded.

const HASH_PREFIX = '#t='

async function pipe(bytes: Uint8Array<ArrayBuffer>, stream: GenericTransformStream): Promise<Uint8Array> {
  const out = new Blob([bytes]).stream().pipeThrough(stream)
  return new Uint8Array(await new Response(out).arrayBuffer())
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

export async function shareUrl(doc: TimelineDoc): Promise<string> {
  const packed = await pipe(new TextEncoder().encode(JSON.stringify(doc)), new CompressionStream('deflate-raw'))
  return `${location.origin}${location.pathname}${HASH_PREFIX}${toBase64Url(packed)}`
}

/** Reads a timeline from the current URL hash, or null if there is none. */
export async function docFromHash(): Promise<TimelineDoc | null> {
  if (!location.hash.startsWith(HASH_PREFIX)) return null
  const bytes = fromBase64Url(location.hash.slice(HASH_PREFIX.length))
  const json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream('deflate-raw')))
  return parseDoc(JSON.parse(json))
}
