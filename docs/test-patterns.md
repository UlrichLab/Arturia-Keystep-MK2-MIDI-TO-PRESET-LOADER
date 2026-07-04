# Test pattern matrix for reverse engineering the `.keystep` format

Each pattern below should differ from its baseline (pattern A) by exactly
one attribute, so a hex diff isolates exactly one field. Build each on the
KeyStep mk2 in step-record mode (not real-time — step recording removes
quantization/timing as a variable), export it individually via MIDI Control
Center, and save into `samples/` using the filename suggested.

Export procedure per pattern (MCC): Project Browser → Recall From (select
the bank/slot you just wrote) → Save As → export as `.keystep`.

## Baseline

**A — `a-baseline.keystep`**
4 steps, single note C4 on step 1, default velocity, default gate length,
120 BPM, Time Division 1/16.

## Pitch

**B — `b-note-d4.keystep`**
Identical to A, but the note on step 1 is D4 instead of C4.
→ isolates where note pitch is encoded.

**C — `c-note-c5.keystep`**
Identical to A, but the note is C5 (one octave up from C4).
→ confirms pitch encoding is a simple offset (C4 vs C5 diff should equal
12 semitones' worth of whatever B vs A showed, if linear).

## Pattern length

**D — `d-length-8.keystep`**
Identical to A, but pattern length is 8 steps instead of 4 (note still only
on step 1).
→ isolates pattern length field.

**E — `e-length-16.keystep`**
Identical to A, but pattern length is 16 steps.
→ confirms length encoding (linear vs enum) by comparing to D.

## Step position

**F — `f-note-step2.keystep`**
Identical to A, but the C4 note is on step 2 instead of step 1 (step 1
empty).
→ isolates how per-step note placement is addressed/indexed.

## Velocity

**G — `g-velocity-max.keystep`**
Identical to A, but velocity is set to maximum (127) instead of default.

**H — `h-velocity-min.keystep`**
Identical to A, but velocity is set to minimum (1).
→ G vs H vs A isolates the velocity byte and its range mapping.

## Gate length

**I — `i-gate-short.keystep`**
Identical to A, but gate length set to shortest available value.

**J — `j-gate-long.keystep`**
Identical to A, but gate length set to longest available value (tie/legato
if applicable).
→ isolates gate length encoding.

## Multiple notes per step (chord)

**K — `k-chord-step1.keystep`**
Identical to A, but step 1 has a C4+E4+G4 chord instead of a single note.
→ isolates how multiple simultaneous notes per step are stored (fixed slots
vs a count + list).

## Tempo

**L — `l-tempo-140.keystep`**
Identical to A, but sequencer tempo is 140 BPM instead of 120.
→ isolates tempo field (likely per-project rather than per-pattern —
worth testing both a pattern-level and project-level export if MCC
distinguishes them).

## Time Division / grid

**M — `m-timediv-32t.keystep`**
Identical to A, but Time Division set to 1/32T instead of 1/16.
→ isolates time-division/grid field.

## Rec Quantize / Quantize Strength

These only affect real-time recording behavior, not necessarily the stored
pattern — worth testing whether they're even persisted per-pattern or are a
global/device setting (`.keystep_ds`) instead:

**N — `n-recquantize-off.keystep_ds`**
Device settings export with Rec Quantize set to Off.

**O — `o-recquantize-on-50.keystep_ds`**
Device settings export with Rec Quantize On, Quantize Strength 50%.

## Empty pattern (reference/control)

**Z — `z-empty.keystep`**
Same length as A (4 steps), no notes at all.
→ useful as a subtraction baseline against A to isolate the note-presence
field itself, independent of pitch/velocity/gate content.

## Workflow reminder

1. Build pattern on device (step recording; set pattern length first via
   Shift + Length where relevant).
2. Shift + Seq/Save → pick slot → confirm with encoder press (must be saved
   before it's visible to MCC).
3. In MCC: Project Browser → Recall From → pick the slot → Save As → export
   `.keystep` (or `.keystep_ds` for device-settings-only tests N/O).
4. Drop the file into `samples/` with the filename above.
5. Diff against the baseline:
   `python3 tools/hexdiff.py samples/a-baseline.keystep samples/b-note-d4.keystep`
6. Record findings (byte offsets, meaning, value mapping) in
   `docs/findings.md` as they're confirmed.
