# Arturia KeyStep mk2 — MIDI to Preset Loader

Goal: convert a MIDI file into a `.keystep` pattern file that can be imported
via Arturia MIDI Control Center (MCC) into a KeyStep mk2 bank/pattern slot —
i.e. `midi-to-keystep.py input.mid output.keystep --pattern-length 16 --bank 4 --slot 1`.

## Why this is a reverse-engineering project

The `.keystep` (pattern/project export) and `.keystep_ds` (device settings)
file formats used by MIDI Control Center are proprietary and undocumented.
There is no public spec and no existing open-source tool that writes them
(searched GitHub — the closest match, `soyersoyer/sysex-controls`, explicitly
does not support KeyStep/BeatStep Pro sequencer banks). So step one is
decoding the file format from controlled test exports, before any encoder
can be written.

## Already established (from the official manual)

- The mk2 sequencer records incoming MIDI/USB notes in real time
  (manual §2.3.7) — the manual itself describes this as a way to "transfer a
  MIDI clip from a DAW to KeyStep mk2".
- Real-time recording quantizes to the current step grid. Grid resolution is
  `Time Division` (1/2 – 1/32) combined with `Sub Division`
  (straight / triplet `T` / dotted `D`), giving a range of 1/2D – 1/32T
  (manual §2.3.13.1 / §2.3.13.2).
- There's a separate **Rec Quantize** on/off switch and a **Quantize
  Strength** (50% / 100%) setting, reached via long-press on the Sequencer
  button (manual §2.5.6). Quantize only affects real-time recordings, not
  step recordings (§2.3.17). Quantize can also be applied after the fact via
  Shift + Time Division, then Shift + Quantize.
- Patterns live in RAM until explicitly saved: Shift + Seq/Save, turn the
  encoder to pick the destination slot, press the encoder to confirm
  (manual §2.3.1 / §2.3.3 / §3.2.7).
- MCC can export/import patterns as `.keystep` files and global device
  settings as `.keystep_ds` files (manual §7.2.6.1 / §7.5).

See `docs/manual-notes.md` for the fuller writeup this was extracted from.

## Plan

1. **Generate controlled test patterns** on the device that each differ by
   exactly one attribute (note pitch, pattern length, velocity, note count
   per step, gate length, tempo — see `docs/test-patterns.md` for the matrix).
2. **Export each pattern** individually via MCC (Recall From → Save As in the
   Project Browser → export as `.keystep`) into `samples/`.
3. **Diff the exports** with `tools/hexdiff.py` to localize which byte
   offsets encode which parameter.
4. **Write a decoder** first (`.keystep` → human-readable pattern data),
   validate it against every sample.
5. **Only then write the encoder** (MIDI → `.keystep`): parse the MIDI file
   (`mido`), snap notes to the target step grid, emit bytes in the decoded
   layout.

No live sysex transfer is planned — that would need the (also undocumented)
realtime MIDI-Control-Center-to-device protocol. This stays a pure
file-based workflow with MCC as the go-between.

## Status

A genuine export (`samples/MyArturiaChords.keystep2`) turned out to be a
JSON-like text container, not an opaque binary blob — see
`docs/findings.md`. Confirmed (cross-checked against the official manual):
the container structure, the 64 per-(bank, slot) 4096-byte pattern blobs (4
banks x 16 slots, matching the hardware exactly), the "empty slot = 4096x
0xFF" convention, and each step record's 8-slot pitch array + parallel
8-slot velocity array. There's now a working `webapp/` prototype built on
top of this (see below), verified end-to-end against the real sample
(MIDI in, patched `.keystep2` out, round-tripped through both the JS and
Python parsers, all untouched slots byte-identical). Still open: exactly
where per-pattern Seq Length and Tempo are stored among the scalar params
— until that's confirmed, the web app can't change a slot's length/tempo,
only its note content (see `docs/findings.md` for what's needed to close
that gap).

## Web app: `webapp/`

A drag-and-drop tool (static HTML/JS, no build step, no server-side code,
no CDN dependencies) modeled on the idea of
[dropedit](https://jamesmacaulay.github.io/dropedit/) but for the KeyStep
mk2's bank/pattern grid instead of a sample pad grid:

1. Open `webapp/index.html` in a browser (Chrome/Edge recommended; serving
   it via a tiny local server — e.g. `python3 -m http.server` from the
   `webapp/` folder — is more reliable than opening the file directly,
   since some browsers restrict Drag & Drop / downloads on `file://` pages).
2. Drop your own exported `.keystep2` backup onto the "Basisdatei" zone —
   this is used both as the file to patch and as the source of truth for
   which slots already have data.
3. Pick a bank tab (1-4), then drag a `.mid` file onto one of the 16 pads.
   The file gets parsed and quantized (resolution selectable, default
   1/16) right there in the browser — nothing is uploaded anywhere.
4. Click "Angepasste .keystep2 herunterladen" to get a modified copy of
   your project file with the new pattern(s) written in.
5. Import that file back into MIDI Control Center and use "Store To" to
   write it to the device — no manual recording on the hardware needed.

Current limitations (see `docs/findings.md`):
- Writing into a slot that's *already populated* is solid — its existing
  Tempo/Length/Scale/etc. settings are preserved untouched, only the note
  content changes.
- Writing into a slot that's currently *empty* is marked experimental in
  the UI: it clones another populated slot's settings as a starting
  template, since we don't yet know how to synthesize those settings from
  scratch.
- Pattern length isn't (yet) adjustable by the tool — a MIDI file longer
  than the target slot's existing length may get silently truncated on
  playback until Seq Length's storage location is confirmed.

## Tools

### `tools/hexdiff.py`

Byte-level diff between two binary files, formatted as a hexdump with
differing bytes bracketed (`[XX]`) and the offset column on the left.

```
python3 tools/hexdiff.py samples/a-note-c4.keystep samples/b-note-d4.keystep
```

Options:
- `--context N` — rows of unchanged context to print around each diff
  (default: 1)
- `--full` — dump the entire file instead of only diff context
