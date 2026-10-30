# Timeliner

Draw the form of a piece of music as nested bubbles, on top of any YouTube video.

Timeliner is inspired by the Variations Audio Timeliner from Indiana University.
You paste a YouTube link instead of loading an audio file.

## How it works

1. Paste a YouTube link and press **Load**.
2. While the video plays, press **T** to cut it into bubbles at the playhead.
3. Shift-click neighbouring bubbles and press **G** to group them into a larger bubble.
4. Select a bubble to give it a label, a color, and an annotation.
5. Press **M** to drop a marker on a single moment.

The panel next to the video shows the labels and annotations under the playhead as it plays.
Press **?** in the app for every keyboard shortcut.

## Saving and sharing

- Timelines save automatically in your browser, one per video.
- **Export** downloads a `.timeline.json` file, and **Import** opens one.
- **Share link** copies a URL that contains the whole timeline.
  Whoever opens it gets their own copy.

Nothing is sent to a server.

## Development

Requires Node 20 or newer.

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the bubble model
npm run build      # type-check and build into dist/
```

## Deploying to GitHub Pages

1. Push this repository to GitHub, on the `main` branch.
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. Every push to `main` runs `.github/workflows/deploy.yml`, which tests, builds, and publishes the site.

The site is served at `https://<user>.github.io/<repo>/`.

## Code map

| File | Purpose |
| --- | --- |
| `src/model.ts` | Bubble tree and its edits: split, group, ungroup, move and remove timepoints. |
| `src/view.ts` | Draws the timeline as SVG. |
| `src/inspector.ts` | Side panel for editing the selected bubble, marker, or timepoint. |
| `src/main.ts` | App state, undo, mouse and keyboard input, loading. |
| `src/player.ts` | Media player interface used by the editor. |
| `src/youtube.ts` | YouTube implementation of that interface. |
| `src/storage.ts` | Autosave, file import and export, share links. |

Another source, such as Spotify, only needs a new implementation of `MediaPlayer` in `src/player.ts`.

## Limits

- YouTube does not expose the audio itself, so there is no waveform.
- The video player must stay visible, as YouTube's terms require.
- Some videos do not allow embedding; Timeliner shows an error for those.
