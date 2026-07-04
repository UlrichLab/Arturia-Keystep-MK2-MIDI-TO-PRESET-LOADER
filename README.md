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

Reverse engineering not yet started — no test exports collected. Next
concrete step: build the test patterns in `docs/test-patterns.md` on the
device and export them into `samples/`.

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
