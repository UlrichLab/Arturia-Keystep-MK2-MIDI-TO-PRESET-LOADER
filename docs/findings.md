# `.keystep2` file format — findings log

Based on a real export from MIDI Control Center (`samples/MyArturiaChords.keystep2`,
4 banks x 16 patterns, bank 1 populated with 16 different chord patterns,
banks 2-4 empty/factory default). This is a huge head start compared to
starting from nothing — the container format turned out to be discoverable
without any test-pattern matrix. What follows is confirmed vs. still open.

## Container format — CONFIRMED

The file is **not** a fully opaque binary blob. It's a JSON-like text
document:

```
{
	"device": "KeyStep mk2",
	"version": "0.0.1",
	"1_10_16384": 1,
	...
	"WARNING_MESSAGE_SECTION": "WARNING: Binary File section MUST be the LAST section",
	"BINARY_FILE_1_10_49152": "<4096 raw bytes, unescaped binary>",
	...
}
```

It is *not* valid JSON as-is — the `BINARY_FILE_*` values contain raw,
unescaped binary (including literal `"`, `\`, and control bytes), so it must
be parsed with a custom scanner, not `json.loads`. See
`tools/parse_keystep2.py`.

- Scalar keys follow the pattern `"{bank}_{slot}_{paramId}": <int>`, where
  `bank` is 1-4 and `slot` is 1-16 — this lines up exactly with the
  hardware's 4 banks x 16 patterns.
- There are 64 `BINARY_FILE_{bank}_{slot}_49152` keys — one per (bank, slot)
  pair. Each value is **exactly 4096 bytes**.
- An empty/unused pattern slot's blob is 4096 bytes of `0xFF`. This is a
  clean, confirmed "blank" reference (bank 2-4 in the sample are all empty).

## Per-slot 4096-byte blob layout — PARTIALLY CONFIRMED

- Offset `0x00-0xC1` (193 bytes): mostly a fixed template, near-identical
  across all 16 populated patterns in the sample. Bytes `0x03-0x06` show
  minor variation between patterns; meaning not yet known (candidates:
  checksum, per-pattern flags). Not yet linked to any specific manual
  setting.
- Offset `0xC1` onward: a repeating **36-byte step record**, confirmed by
  autocorrelation (period 36, >96% match) and by eye once aligned. Layout
  per record (offsets relative to the record start):

  | bytes | contents (in this sample) | hypothesis |
  |-------|---------------------------|------------|
  | 0     | e.g. `0x3C` (=60=C4), `0x24`, `0x30`... | note pitch, slot A |
  | 1-7   | `0x80` repeated | sentinel for "no note" — up to 8 note slots (chord capacity) |
  | 8     | e.g. `0x71`, `0x61`, `0x49`... | a second value per step — **ambiguous**, see below |
  | 9-15  | `0x64` (100 decimal) repeated | sentinel for slots 9-15 — different sentinel than bytes 1-7 |
  | 16    | `0x02` (constant in this sample) | possibly "active note count", but only one candidate sample so unconfirmed |
  | 17-23 | `0x01` repeated | unknown, constant in this sample |
  | 24-32 | `0x00` repeated | unknown, constant/off in this sample |
  | 33    | `0x00` | unknown |
  | 34    | `0x01` | unknown, possibly a step-enabled flag |
  | 35    | `0x00` | unknown |

  **Open ambiguity on byte 8 / bytes 9-15**: this could be (a) a second
  note's pitch with its own 8-slot array using sentinel `0x64` instead of
  `0x80` (would mean this sample's patterns are all 2-note chords), or (b)
  the *velocity* of the note in slot 0, with `0x64` (100) as a plausible
  "default velocity" sentinel for the unused slots. Byte 8's observed values
  (0x49-0x74, i.e. 73-116 decimal) are plausible as either a note pitch or a
  velocity. Can't disambiguate from this sample alone because velocity was
  never deliberately varied and no single/mono-note pattern is present to
  compare against.

  The step region in each 4096-byte blob appears to hold far more step
  slots than any one pattern needs (~93 by raw byte count) and the actual
  recorded chord sequence (~16-18 distinct steps per pattern in this
  sample) repeats cyclically to fill the rest before the buffer reverts to
  zeroes and finally back to `0xFF`. This suggests **pattern length is
  stored elsewhere** (most likely one of the per-slot scalar params below),
  not implied by where the step data stops.

## Per-slot scalar params — NOT YET DECODED

Confirmed param IDs seen per (bank, slot): `8192-8197`, `16384`, `16385`,
`24576-24581`, `24586-24588`.

- `16384` = 1 for every populated slot in the sample (bank 1) — likely a
  "slot has data" flag. Not cross-checked against an empty slot (banks 2-4
  don't have scalar entries at all in this export, which itself supports
  this theory — MCC may just omit scalar keys entirely for untouched slots).
- `24580` = 900 (constant across all 16 patterns) — candidate: tempo x10
  (900 → 90.0 BPM) or similar, but not verified against a pattern recorded
  at a different tempo.
- `24577` varies between 63 and 31 across the 16 patterns (a difference of
  exactly 32 / one bit). `24578` varies between 0, 40, and 46. Everything
  else is constant across all 16 patterns in this sample.
- None of the observed values obviously equal a step count matching what
  the step-record region suggests (~16-18). Pattern length encoding is
  still unknown.

## What would resolve the open questions

Targeted single-variable test exports, each compared against the closest
neighbor (see `docs/test-patterns.md` for the general matrix — now
sharpened by what we know):

1. A **monophonic** pattern (no chords) with 2-3 notes at clearly different,
   deliberately chosen velocities (e.g. 1, 64, 127) — resolves the
   byte-8/sentinel-0x64 ambiguity (pitch vs. velocity) immediately.
2. Two patterns identical except for **pattern length** (e.g. 8 vs. 16
   steps) — needed to find where length is actually stored, since it's
   evidently not simply "where the step data stops."
3. Two patterns identical except for **tempo** — to confirm/refute the
   `24580 == tempo * 10` hypothesis.
4. A genuine 3-4 note chord on one step, with the rest of the pattern empty
   — to confirm whether there really are two independent 8-slot note arrays
   (supporting multi-note chords) or just one note + one other parameter.

## Tools

- `tools/parse_keystep2.py summary FILE` — lists which (bank, slot) pairs
  have data.
- `tools/parse_keystep2.py scalars FILE [--bank N] [--slot N]` — dumps the
  per-slot scalar params.
- `tools/parse_keystep2.py steps FILE BANK SLOT` — best-effort decode of a
  slot's step records (see caveats above).
- `tools/parse_keystep2.py dump-blob FILE BANK SLOT [--out path]` — extract
  a slot's raw 4096-byte blob for hexdiff.py.
