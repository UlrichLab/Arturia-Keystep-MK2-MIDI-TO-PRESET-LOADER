// Parser/patcher for Arturia KeyStep mk2 `.keystep2` project exports.
// Ported from tools/parse_keystep2.py — see docs/findings.md for what's
// confirmed vs. still open about this format.
//
// The file is JSON-like text with raw, unescaped binary embedded in the
// "BINARY_FILE_*" string values, so it can't go through JSON.parse. We treat
// the whole file as a "binary string" (one JS string char per byte, via
// String.fromCharCode) so plain string regex/slice operations stay
// byte-exact.

const STEP_RECORD_SIZE = 36;
const STEP_DATA_OFFSET = 0xc1;
const BLOB_SIZE = 4096;
const NOTE_SENTINEL = 0x80;
const VELOCITY_SENTINEL = 0x64;
// Bytes 16-35 of a step record: meaning not fully confirmed (see
// docs/findings.md). This is the constant pattern observed in every real
// step of the one real-world sample seen so far — used as the safe default
// for newly-generated steps.
const STEP_TAIL_TEMPLATE = [
  0x02, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x01, 0x00,
];

function bytesToBinaryString(bytes) {
  let s = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return s;
}

function binaryStringToBytes(s) {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes;
}

const BINARY_KEY_RE = /"BINARY_FILE_(\d+)_(\d+)_49152":\s*"/g;
const SCALAR_KEY_RE = /"(\d+)_(\d+)_(\d+)"\s*:\s*(-?\d+)/g;

function parseKeystep2(binaryString) {
  const matches = [];
  BINARY_KEY_RE.lastIndex = 0;
  let m;
  while ((m = BINARY_KEY_RE.exec(binaryString)) !== null) {
    matches.push({ index: m.index, end: BINARY_KEY_RE.lastIndex, bank: +m[1], slot: +m[2] });
  }
  if (matches.length === 0) throw new Error("No BINARY_FILE_* keys found — not a recognized .keystep2 file");

  const headerText = binaryString.slice(0, matches[0].index);
  const scalars = new Map(); // "bank_slot_paramId" -> value
  SCALAR_KEY_RE.lastIndex = 0;
  while ((m = SCALAR_KEY_RE.exec(headerText)) !== null) {
    scalars.set(`${m[1]}_${m[2]}_${m[3]}`, parseInt(m[4], 10));
  }

  const blobs = new Map(); // "bank_slot" -> { start, end, bytes: Uint8Array(4096) }
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].index : binaryString.length;
    const trailer = i + 1 < matches.length ? '",\n\t' : '",\n}';
    const raw = binaryString.slice(start, end);
    if (!raw.endsWith(trailer)) {
      throw new Error(`Unexpected trailer for bank ${matches[i].bank} slot ${matches[i].slot}`);
    }
    const value = raw.slice(0, raw.length - trailer.length);
    blobs.set(`${matches[i].bank}_${matches[i].slot}`, {
      start,
      end: end - trailer.length,
      bytes: binaryStringToBytes(value),
    });
  }

  return { binaryString, headerText, scalars, blobs };
}

function isEmptyBlob(bytes) {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0xff) return false;
  return true;
}

function decodeSteps(blobBytes) {
  const steps = [];
  let offset = STEP_DATA_OFFSET;
  while (offset + STEP_RECORD_SIZE <= blobBytes.length) {
    const record = blobBytes.subarray(offset, offset + STEP_RECORD_SIZE);
    if (isEmptyBlob(record)) break;
    const notes = [];
    for (let i = 0; i < 8; i++) {
      if (record[i] !== NOTE_SENTINEL) notes.push({ pitch: record[i], velocity: record[8 + i] });
    }
    steps.push(notes);
    offset += STEP_RECORD_SIZE;
  }
  return steps;
}

// steps: array of arrays of {pitch, velocity} (max 8 each — extra notes
// dropped, keeping the lowest pitches, matching the manual's documented
// behavior for chords that exceed 8 notes).
function encodeSteps(steps) {
  const stepAreaSize = BLOB_SIZE - STEP_DATA_OFFSET;
  const maxSteps = Math.floor(stepAreaSize / STEP_RECORD_SIZE);
  if (steps.length > maxSteps) throw new Error(`Too many steps: ${steps.length} (max ${maxSteps})`);

  const area = new Uint8Array(stepAreaSize).fill(0xff);
  let offset = 0;
  for (const stepNotes of steps) {
    const sorted = [...stepNotes].sort((a, b) => a.pitch - b.pitch).slice(0, 8);
    const record = new Uint8Array(STEP_RECORD_SIZE);
    for (let i = 0; i < 8; i++) {
      if (i < sorted.length) {
        record[i] = sorted[i].pitch & 0x7f;
        record[8 + i] = sorted[i].velocity & 0x7f;
      } else {
        record[i] = NOTE_SENTINEL;
        record[8 + i] = VELOCITY_SENTINEL;
      }
    }
    record.set(STEP_TAIL_TEMPLATE, 16);
    area.set(record, offset);
    offset += STEP_RECORD_SIZE;
  }
  return area;
}

// Builds a full 4096-byte blob: reuses `templateBytes`'s header
// (0x00-0xC1) — either the slot's own previous content, or another slot's
// as a template for a previously-empty slot — followed by freshly encoded
// step data.
function buildBlob(templateBytes, steps) {
  const blob = new Uint8Array(BLOB_SIZE);
  blob.set(templateBytes.subarray(0, STEP_DATA_OFFSET), 0);
  blob.set(encodeSteps(steps), STEP_DATA_OFFSET);
  return blob;
}

function cloneScalarsForSlot(parsed, fromBank, fromSlot, toBank, toSlot) {
  const lines = [];
  for (const [key, value] of parsed.scalars) {
    const [bank, slot, paramId] = key.split("_");
    if (+bank === fromBank && +slot === fromSlot) {
      lines.push(`\t"${toBank}_${toSlot}_${paramId}": ${value}`);
    }
  }
  return lines;
}

// Applies a set of { bank, slot, blobBytes, newScalarLines? } patches to the
// original file and returns a new binary string ready to save.
function applyPatches(parsed, patches) {
  let result = parsed.binaryString;
  const additionalScalarLines = [];

  // Apply blob replacements back-to-front so earlier offsets stay valid.
  const sortedPatches = [...patches].sort((a, b) => {
    const blobA = parsed.blobs.get(`${a.bank}_${a.slot}`);
    const blobB = parsed.blobs.get(`${b.bank}_${b.slot}`);
    return blobB.start - blobA.start;
  });

  for (const patch of sortedPatches) {
    const blobInfo = parsed.blobs.get(`${patch.bank}_${patch.slot}`);
    if (!blobInfo) throw new Error(`No blob found for bank ${patch.bank} slot ${patch.slot}`);
    if (patch.blobBytes.length !== BLOB_SIZE) throw new Error("Patched blob must be exactly 4096 bytes");
    const newValueString = bytesToBinaryString(patch.blobBytes);
    result = result.slice(0, blobInfo.start) + newValueString + result.slice(blobInfo.end);
    if (patch.newScalarLines && patch.newScalarLines.length) {
      additionalScalarLines.push(...patch.newScalarLines);
    }
  }

  if (additionalScalarLines.length) {
    const marker = '"WARNING_MESSAGE_SECTION"';
    const idx = result.indexOf(marker);
    if (idx === -1) throw new Error("Could not find WARNING_MESSAGE_SECTION marker to insert new scalar params");
    result = result.slice(0, idx) + additionalScalarLines.join(",\n") + ",\n\t" + result.slice(idx);
  }

  return result;
}

if (typeof module !== "undefined") {
  module.exports = {
    parseKeystep2, isEmptyBlob, decodeSteps, encodeSteps, buildBlob,
    cloneScalarsForSlot, applyPatches, BLOB_SIZE, STEP_DATA_OFFSET, STEP_RECORD_SIZE,
  };
}
