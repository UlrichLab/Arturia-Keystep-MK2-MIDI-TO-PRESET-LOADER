# Notes from the KeyStep mk2 manual (v1.1.0 EN)

Extracted while researching whether/how the sequencer can capture a MIDI
clip from a DAW, and how `.keystep` pattern exports work.

## Recording MIDI/USB input into the sequencer (§2.3.7)

"What does the Sequencer record?"
- The notes played from the keyboard
- Data that arrives via MIDI or USB
- The velocity of each note

"If real-time record is enabled, notes will be recorded. This is [a]
convenient way to 'transfer' a MIDI clip from a DAW to Keystep mk2."

Practical flow:
1. Sequencer mode, pick the target pattern slot.
2. Press Record (sequencer not yet running), then press Play. Record button
   lights, the sequence starts looping.
3. Play the DAW clip (MIDI channel must match the KeyStep's input channel).
4. Incoming notes are quantized to the nearest step.
5. Stop to finish.

Important: real-time recording does **not** extend the pattern length.
Set the desired pattern length beforehand — either via step recording or
Shift + Length (§2.3.2) — otherwise the clip won't fit.

## Real-time recording & quantization (§2.3.3, §2.3.13.1/.2, §2.5.6, §2.3.17)

"Watch the Metronome on the screen for sync reference. The notes you play
'live' will be quantized to the nearest step."

The mk2 is fundamentally a step sequencer — even real-time recording snaps
to a grid, never fully free timing.

Grid resolution:
- `Time Division`: 1/2 to 1/32
- `Sub Division`: straight, triplet (T), or dotted (D)
- Combined range: 1/2D – 1/32T (1/32T is the finest — 32nd-note triplets)

Separate `Rec Quantize` setting (long-press the Sequencer button to reach
the settings menu):
- `Rec Quantize`: On/Off — whether real-time recording gets additionally
  corrected to the grid at all
- `Quantize Strength`: 50% or 100% — 50% keeps part of the original feel,
  100% forces notes fully onto the grid
- Quantize only affects real-time recordings, not step recordings (§2.3.17)
- Quantize can also be applied retroactively to an already-recorded pattern:
  hold Shift + Time Division key, then Shift + Quantize key (note box in
  §2.5.6)

### Setting Rec Quantize on the device

1. Long-press the Sequencer ("Seq") button → opens the Sequencer settings
   menu.
2. Turn the encoder until the display shows "Rec Quantize".
3. Press the encoder → toggles On/Off.
4. Press Back to exit.

### Setting Quantize Strength on the device

1. Long-press Sequencer button (if not already in the menu).
2. Turn the encoder until the display shows "Quantize" (the strength value,
   distinct from the "Rec Quantize" on/off entry).
3. Press the encoder, then choose between 50% and 100%.
4. Press the encoder again to confirm.

For transferring a DAW clip as close to the original timing as possible:
set `Rec Quantize` to Off (only the fine time-division grid still applies),
or if some correction is wanted, `Quantize Strength` to 50%. Even at the
finest grid (1/32T) sub-millisecond DAW timing is still lost — the device
remains a step sequencer with a very fine grid, not a 1:1 MIDI recorder.

## Saving patterns (§2.3.1, §2.3.3, §3.2.7)

Recording happens in real time into the pattern currently held in RAM
("the Sequencer Pattern held in RAM", §3.2.7 re: Arpeggio to Sequence). This
is not automatically persisted.

"Remember to save your Patterns! Hold Shift and Sequencer/Save, then select
the location by turning the Encoder. Confirm by pressing the Encoder."

Without this step the recording is lost on power-off.

## `.keystep` / `.keystep_ds` file export (§7.2.6.1, §7.5)

MIDI Control Center can export/import:
- Patterns/projects as `.keystep` files (Project Browser: Recall From →
  Save As → export)
- Global device settings as `.keystep_ds` files

Both formats are proprietary and not publicly documented anywhere found so
far (checked GitHub for existing tools — see README for what was found).
