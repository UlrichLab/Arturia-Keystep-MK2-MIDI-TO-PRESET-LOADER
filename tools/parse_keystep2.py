#!/usr/bin/env python3
"""Parser for Arturia KeyStep mk2 `.keystep2` project export files.

The file is a JSON-like text document (not strictly valid JSON — it embeds
raw, unescaped binary inside string values for the "BINARY_FILE_*" keys,
so it can't be passed straight to json.loads). Structure found so far:

- A handful of top-level keys: "device", "version".
- Per (bank, slot) scalar parameters, keyed "{bank}_{slot}_{paramId}": value.
  bank is 1-4, slot is 1-16 (matches the hardware's 4 banks x 16 patterns).
  paramId meanings are not yet fully decoded (see docs/findings.md).
- A "WARNING_MESSAGE_SECTION" marker key.
- 64 "BINARY_FILE_{bank}_{slot}_49152": "<4096 raw bytes>" entries, one per
  (bank, slot) pattern slot. An unused/empty slot is 4096 bytes of 0xFF.
"""
import argparse
import json
import re
import sys
from pathlib import Path

BINARY_KEY_RE = re.compile(rb'"BINARY_FILE_(\d+)_(\d+)_49152":\s*"')
SCALAR_KEY_RE = re.compile(r'"(\d+)_(\d+)_(\d+)"\s*:\s*(-?\d+)')

STEP_RECORD_SIZE = 36
STEP_DATA_OFFSET = 0xC1


def parse_file(path):
    data = Path(path).read_bytes()

    binary_matches = list(BINARY_KEY_RE.finditer(data))
    header_text = data[:binary_matches[0].start()].decode("ascii", errors="replace")

    scalars = {}
    for m in SCALAR_KEY_RE.finditer(header_text):
        bank, slot, param_id, value = m.groups()
        scalars[(int(bank), int(slot), int(param_id))] = int(value)

    blobs = {}
    for i, m in enumerate(binary_matches):
        start = m.end()
        end = binary_matches[i + 1].start() if i + 1 < len(binary_matches) else len(data)
        raw = data[start:end]
        trailer = b'",\n\t' if i + 1 < len(binary_matches) else b'",\n}'
        if not raw.endswith(trailer):
            raise ValueError(f"unexpected trailer for slot {m.groups()}: {raw[-10:]!r}")
        value = raw[:-len(trailer)]
        bank, slot = int(m.group(1)), int(m.group(2))
        blobs[(bank, slot)] = value

    return scalars, blobs


def is_empty_blob(blob):
    return blob == b"\xff" * len(blob)


def decode_steps(blob):
    """Best-effort decode of the per-step record area. See docs/findings.md
    for what's confirmed vs. still guessed."""
    steps = []
    offset = STEP_DATA_OFFSET
    while offset + STEP_RECORD_SIZE <= len(blob):
        record = blob[offset:offset + STEP_RECORD_SIZE]
        if is_empty_blob(record):
            break
        pitches = record[0:8]
        velocities = record[8:16]
        flags = record[16:24]
        notes = [(p, v) for p, v in zip(pitches, velocities) if p != 0x80]
        steps.append({
            "notes": notes,
            "pitches": pitches,
            "velocities": velocities,
            "flags": flags,
            "raw": record,
        })
        offset += STEP_RECORD_SIZE
    return steps


def cmd_summary(args):
    scalars, blobs = parse_file(args.file)
    print(f"{len(scalars)} scalar params, {len(blobs)} pattern blobs\n")
    for (bank, slot), blob in sorted(blobs.items()):
        if is_empty_blob(blob):
            print(f"bank {bank} slot {slot:2d}: empty")
            continue
        steps = decode_steps(blob)
        print(f"bank {bank} slot {slot:2d}: ~{len(steps)} step(s) with data "
              f"(first step: {steps[0]['notes']})" if steps else
              f"bank {bank} slot {slot:2d}: non-empty but no decodable steps")


def cmd_dump_blob(args):
    _, blobs = parse_file(args.file)
    key = (args.bank, args.slot)
    if key not in blobs:
        sys.exit(f"no such slot: bank {args.bank} slot {args.slot}")
    out = Path(args.out) if args.out else Path(f"bank{args.bank}_slot{args.slot}.bin")
    out.write_bytes(blobs[key])
    print(f"wrote {len(blobs[key])} bytes to {out}")


def cmd_dump_scalars(args):
    scalars, _ = parse_file(args.file)
    for (bank, slot, param_id), value in sorted(scalars.items()):
        if args.bank and bank != args.bank:
            continue
        if args.slot and slot != args.slot:
            continue
        print(f"{bank}_{slot}_{param_id} = {value}")


def cmd_steps(args):
    _, blobs = parse_file(args.file)
    key = (args.bank, args.slot)
    if key not in blobs:
        sys.exit(f"no such slot: bank {args.bank} slot {args.slot}")
    steps = decode_steps(blobs[key])
    for i, step in enumerate(steps):
        notes = ", ".join(f"pitch={p:#04x} vel={v:#04x}" for p, v in step["notes"]) or "(empty step)"
        print(f"step {i:3d}: {notes}")


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                      formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_summary = sub.add_parser("summary", help="list which bank/slot pairs have pattern data")
    p_summary.add_argument("file")
    p_summary.set_defaults(func=cmd_summary)

    p_blob = sub.add_parser("dump-blob", help="extract one slot's raw 4096-byte blob to a file")
    p_blob.add_argument("file")
    p_blob.add_argument("bank", type=int)
    p_blob.add_argument("slot", type=int)
    p_blob.add_argument("--out")
    p_blob.set_defaults(func=cmd_dump_blob)

    p_scalars = sub.add_parser("scalars", help="print the {bank}_{slot}_{paramId} scalar params")
    p_scalars.add_argument("file")
    p_scalars.add_argument("--bank", type=int)
    p_scalars.add_argument("--slot", type=int)
    p_scalars.set_defaults(func=cmd_dump_scalars)

    p_steps = sub.add_parser("steps", help="best-effort decode of one slot's per-step records")
    p_steps.add_argument("file")
    p_steps.add_argument("bank", type=int)
    p_steps.add_argument("slot", type=int)
    p_steps.set_defaults(func=cmd_steps)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
