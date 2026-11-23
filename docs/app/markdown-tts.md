# Markdown-aware text-to-speech

## Engine capabilities

Out Loud uses **Kokoro-82M** (ONNX) with **espeak-ng** phonemization. This stack does **not** expose SSML `<emphasis>`, per-word pitch, or volume. Global playback speed is the only prosody control on the neural side.

Expressive delivery for markdown therefore uses the same mechanism as plain text: **pause markers** (`[0.4s]`, etc.) that `sanitizeText()` in `electron/tts-worker.ts` already converts into silence chunks. Bold/italic cannot change timbre; they get a short pre-pause so emphasis reads as a slight rhythmic cue.

## Conversion rules

| Markdown                | Spoken output                                  |
| ----------------------- | ---------------------------------------------- |
| `# Heading`             | Pause, then heading words (no `#`)             |
| `**bold**` / `__bold__` | Words with a short pre-pause                   |
| `*italic*` / `_italic_` | Words (markers stripped)                       |
| `[label](url)`          | `label` only                                   |
| `` `code` ``            | Literal code text                              |
| ` ``` ` blocks          | Omitted; brief pause between surrounding prose |
| Lists                   | Item text; pauses between items                |
| `---`                   | Longer pause                                   |

Plain text that does not match markdown heuristics is passed through **unchanged**.

## Highlight sync

The editor keeps the user's markdown source. Chunk highlighting maps audio chunk positions on the speakable string back onto source indices via `sourceIndexByOutput` in `electron/markdown-for-speech.ts`.

## Entry points

`prepareSpeechText()` runs inside the TTS worker (`buildUnits`) so quick-speak, HTTP API, and extensions all share one code path. The renderer also converts before IPC so highlight indices align with the worker input.
