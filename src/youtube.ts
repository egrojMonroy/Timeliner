import type { MediaPlayer } from './player'

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void
  }
}

const ID_PATTERN = /^[\w-]{11}$/

/** Extracts a YouTube video id from a URL or a bare id. Returns null if none is found. */
export function parseYouTubeId(input: string): string | null {
  const text = input.trim()
  if (ID_PATTERN.test(text)) return text
  let url: URL
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`)
  } catch {
    return null
  }
  const host = url.hostname.replace(/^(www|m|music)\./, '')
  let id: string | null = null
  if (host === 'youtu.be') id = url.pathname.slice(1).split('/')[0] ?? null
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v')
    const path = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/)
    if (id == null && path != null) id = path[1] ?? null
  }
  return id != null && ID_PATTERN.test(id) ? id : null
}

let apiPromise: Promise<void> | null = null

function loadApi(): Promise<void> {
  apiPromise ??= new Promise((resolve, reject) => {
    if (typeof YT !== 'undefined' && typeof YT.Player === 'function') {
      resolve()
      return
    }
    window.onYouTubeIframeAPIReady = () => resolve()
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.onerror = () => {
      apiPromise = null
      reject(new Error('Could not load the YouTube player. Check your connection.'))
    }
    document.head.append(script)
  })
  return apiPromise
}

const ERROR_MESSAGES: Record<number, string> = {
  2: 'That YouTube link is not valid.',
  5: 'This video cannot be played in an HTML5 player.',
  100: 'This video was removed or is private.',
  101: 'The owner does not allow this video to be embedded.',
  150: 'The owner does not allow this video to be embedded.',
}

// Duration can read 0 right after onReady; poll briefly until YouTube knows it.
async function waitForDuration(player: YT.Player): Promise<number> {
  for (let i = 0; i < 50; i++) {
    const d = player.getDuration()
    if (d > 0) return d
    await new Promise((r) => setTimeout(r, 100))
  }
  return 0
}

/**
 * Creates a YouTube player inside `host` and resolves once the video's duration is known.
 * `onStateChange` fires on play, pause, and end.
 */
export async function createYouTubePlayer(
  host: HTMLElement,
  videoId: string,
  onStateChange: () => void,
): Promise<MediaPlayer> {
  await loadApi()
  const mount = document.createElement('div')
  host.replaceChildren(mount)

  const player = await new Promise<YT.Player>((resolve, reject) => {
    const p = new YT.Player(mount, {
      videoId,
      width: '100%',
      height: '100%',
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => resolve(p),
        onStateChange: () => onStateChange(),
        onError: (e) => reject(new Error(ERROR_MESSAGES[e.data] ?? `YouTube error ${e.data}.`)),
      },
    })
  })

  const duration = await waitForDuration(player)
  if (duration === 0) throw new Error('YouTube did not report a length for this video.')

  return {
    play: () => player.playVideo(),
    pause: () => player.pauseVideo(),
    seek: (seconds) => player.seekTo(seconds, true),
    getTime: () => player.getCurrentTime(),
    getDuration: () => duration,
    isPlaying: () => player.getPlayerState() === YT.PlayerState.PLAYING,
    getTitle: () => player.getVideoData().title,
    destroy: () => {
      player.destroy()
      host.replaceChildren()
    },
  }
}
