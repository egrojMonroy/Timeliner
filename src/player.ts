// The timeline only talks to media through this interface, so another source
// (for example Spotify) can be added without touching the editor.
export interface MediaPlayer {
  play(): void
  pause(): void
  seek(seconds: number): void
  /** Current position in seconds. */
  getTime(): number
  /** Length in seconds. */
  getDuration(): number
  isPlaying(): boolean
  /** Title reported by the source, or '' if unknown. */
  getTitle(): string
  destroy(): void
}
