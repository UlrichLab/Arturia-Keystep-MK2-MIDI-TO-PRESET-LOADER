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

## Per-slot 4096-byte blob layout — MOSTLY CONFIRMED (with manual cross-check)

The official manual (v1.1.0 EN) independently confirms the two things that
were ambiguous purely from byte-diffing:

- "Each Pattern can be 64 steps long with up to **8 notes per step**"
  (manual, Sequencer chapter) — directly matches the 8-slot note array
  found in the step record.
- "The Sequencer records ... **the velocity of each note**" and separately
  lists "The duration (Gate time) of the note" under **what it does NOT
  record** — Gate is explicitly a per-pattern setting, not per-note/per-step.
  This rules out one of the earlier byte-8 hypotheses and confirms the step
  record needs a per-note *velocity* field, not a second pitch field.

Offset `0x00-0xC1` (193 bytes): mostly a fixed template, near-identical
across all 16 populated patterns in the sample. Bytes `0x03-0x06` show
minor variation between patterns; meaning not yet known.

Offset `0xC1` onward: a repeating **36-byte step record**, confirmed by
autocorrelation (period 36, >96% match). Revised layout per record (offsets
relative to the record start), now read in light of the manual:

| bytes | contents (in this sample) | meaning |
|-------|---------------------------|---------|
| 0-7   | e.g. `[0x3C, 0x80,0x80,0x80,0x80,0x80,0x80,0x80]` | **note pitch array, 8 slots** (one per possible stacked note this step). `0x80` (128, invalid MIDI note) = "no note in this slot". Matches the manual's confirmed 8-notes-per-step maximum. |
| 8-15  | e.g. `[0x71, 0x64,0x64,0x64,0x64,0x64,0x64,0x64]` | **velocity array, 8 slots**, parallel to the pitch array above. `0x64` (100 decimal) is the sentinel for unused slots — consistent with the manual's "Fixed Velocity value of 100" being the device's standard default/neutral velocity (Controls > Velocity Curve). Slot 0's velocity (e.g. 0x71=113, 0x61=97, 0x49=73...) plausibly reflects real recorded velocity. |
| 16    | `0x02` (constant in this sample) | unknown per-step flag/count — only one real note was ever present in this sample's steps, so this can't yet be confirmed as "active note count" (would expect to see it track 1, not 2) |
| 17-23 | `0x01` repeated | unknown, constant in this sample (padding parallel to the note/velocity arrays for slots 1-7?) |
| 24-32 | `0x00` repeated | unknown, constant/off in this sample |
| 33-35 | `00 01 00` | unknown, constant in this sample |

Remaining open question on this record: what byte 16 and bytes 17-35
actually encode (tie/rest flags? ratchet/probability, per the Spice
feature? a real per-step "note count" that just happens to always read 2
here for reasons TBD). Not blocking — the two fields that matter most for
an encoder (pitch, velocity) are now solid.

The step region in each 4096-byte blob appears to hold far more step slots
than any one pattern needs (~93 by raw byte count, vs. the hardware's
confirmed 64-step maximum) and the actual recorded sequence repeats
cyclically to fill the rest before the buffer reverts to zeroes and finally
back to `0xFF`. This confirms **pattern length is stored elsewhere** (one of
the per-slot scalar params below), not implied by where the step data stops.

## Per-slot scalar params — param COUNT confirmed by the manual, exact mapping still open

Confirmed param IDs seen per (bank, slot): `8192-8197` (6 values),
`16384-16385` (2 values), `24576-24581` + `24586-24588` (9 values). 17
total.

The manual's MIDI Control Center chapter (7.3.1/7.3.2) states the exact,
complete list of per-Pattern settings exposed in MCC's Sequencer Settings
page — and it's **also 17 parameters**, in the same 6 / 2 / 9 grouping:

- **Pattern Chord** (6): Preset, Spread, Strum (ms), Strum (Sync), Strum
  Type, Voicing → almost certainly the `8192-8197` group (all constant 0 in
  the sample — this file's patterns don't use the Chord engine).
- **Pattern Scale** (2): Pattern Root, Pattern Scale → almost certainly the
  `16384-16385` group (`16384`=1, `16385`=0 in every populated slot).
- **Timing** (Tempo, Swing, Time Division) + **Seq Settings** (Gate, Spice,
  Seq Length) + **Program Change** (Bank MSB, Bank LSB, Program Change) = 9
  → the `24576-24581, 24586-24588` group. Exact order within this group of
  9 is *not yet confirmed* — candidates and reasoning:
  - `24580` = 900 (constant) — best fit is **Tempo x10** (900 → 90.0 BPM),
    a plausible default.
  - `24579`, `24581`, `24586`, `24587`, `24588` = 0 (constant) — fits
    **Spice** (off by default) and **Bank MSB / Bank LSB / Program Change**
    (disabled/default) reasonably well, but which ID is which is unconfirmed.
  - `24577` varies 63 / 31 (differ by one bit, 0x20) and `24578` varies 0 /
    40 / 46 across the 16 patterns — the only two fields that actually
    change in this sample. Neither cleanly fits **Swing** (documented
    range: 50-75%) or **Gate** (documented range: 10-90%) at face value, so
    these are more likely **Time Division** (an enum/bitmask over the
    1/2D-1/32T range) and something else not yet identified. Needs a real
    test to pin down.
  - **Seq Length is conspicuously not confirmed anywhere yet** — none of
    the observed values obviously read as a small 1-64 step count. Since
    all 16 patterns in this sample may simply share the same length, it's
    plausibly one of the fields currently showing as "constant" rather than
    a distinct one we can already point to.

## What would still resolve the remaining open questions

Two more real-world test exports would settle this decisively (both are
easy to produce precisely, since they're set via the device's numeric
menus, not by playing feel):

1. **Two patterns identical except for Seq Length** (e.g. 8 vs. 16 steps,
   set explicitly via Shift + Length before recording) — pins down exactly
   which scalar param is length, since content is otherwise identical.
2. **Two patterns identical except for Tempo** (e.g. 90 vs. 140 BPM, set
   via the Tempo menu) — confirms/refutes the `24580 == tempo * 10` guess
   and rules it in or out for the varying fields too.

Lower priority now that the manual resolved the pitch/velocity ambiguity
structurally:

3. A monophonic pattern with a couple of notes at clearly different
   velocities (soft vs. hard is enough — exact numbers don't matter) —
   nice-to-have confirmation, not required to proceed.
4. A real stacked chord (4+ notes on one step) — confirms the 8-slot
   pitch/velocity arrays fill in parallel as expected, and might reveal
   what byte 16 (currently always `0x02`) does when note count actually
   changes.

## Tools

- `tools/parse_keystep2.py summary FILE` — lists which (bank, slot) pairs
  have data.
- `tools/parse_keystep2.py scalars FILE [--bank N] [--slot N]` — dumps the
  per-slot scalar params.
- `tools/parse_keystep2.py steps FILE BANK SLOT` — best-effort decode of a
  slot's step records (see caveats above).
- `tools/parse_keystep2.py dump-blob FILE BANK SLOT [--out path]` — extract
  a slot's raw 4096-byte blob for hexdiff.py.
