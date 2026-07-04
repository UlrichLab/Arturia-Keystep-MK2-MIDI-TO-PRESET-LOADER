// Minimal Standard MIDI File (SMF) reader — just enough to pull out notes,
// tempo, and ticks-per-beat. No external dependencies on purpose (this runs
// as a local file, no bundler, no CDN).

function parseMidiFile(bytes) {
  let pos = 0;
  function u8() { return bytes[pos++]; }
  function u16() { const v = (bytes[pos] << 8) | bytes[pos + 1]; pos += 2; return v; }
  function u32() {
    const v = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
    pos += 4;
    return v >>> 0;
  }
  function readChunkHeader() {
    const id = String.fromCharCode(bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]);
    pos += 4;
    const length = u32();
    return { id, length };
  }
  function readVarLen() {
    let value = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      value = (value << 7) | (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    return value;
  }

  const header = readChunkHeader();
  if (header.id !== "MThd") throw new Error("Not a MIDI file (missing MThd)");
  const format = u16();
  const numTracks = u16();
  const division = u16();
  if (division & 0x8000) throw new Error("SMPTE time division not supported");
  const ticksPerBeat = division;

  const notes = [];
  let tempoUsPerBeat = 500000; // 120 BPM default, overwritten by the first Set Tempo event found

  for (let t = 0; t < numTracks; t++) {
    const trackHeader = readChunkHeader();
    if (trackHeader.id !== "MTrk") {
      pos += trackHeader.length;
      continue;
    }
    const trackEnd = pos + trackHeader.length;
    let tick = 0;
    let runningStatus = null;
    const activeNotes = new Map(); // "channel_pitch" -> { startTick, velocity }

    while (pos < trackEnd) {
      const delta = readVarLen();
      tick += delta;

      let statusByte = bytes[pos];
      if (statusByte & 0x80) {
        pos++;
        runningStatus = statusByte;
      } else {
        statusByte = runningStatus;
      }

      const type = statusByte & 0xf0;
      const channel = statusByte & 0x0f;

      if (statusByte === 0xff) {
        const metaType = u8();
        const len = readVarLen();
        if (metaType === 0x51 && len === 3) {
          tempoUsPerBeat = (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2];
        }
        pos += len;
      } else if (statusByte === 0xf0 || statusByte === 0xf7) {
        const len = readVarLen();
        pos += len;
      } else if (type === 0x90 || type === 0x80) {
        const pitch = u8();
        const velocity = u8();
        const key = channel + "_" + pitch;
        if (type === 0x90 && velocity > 0) {
          activeNotes.set(key, { startTick: tick, velocity });
        } else {
          const active = activeNotes.get(key);
          if (active) {
            notes.push({
              pitch,
              velocity: active.velocity,
              startTick: active.startTick,
              durationTicks: Math.max(1, tick - active.startTick),
            });
            activeNotes.delete(key);
          }
        }
      } else if (type === 0xa0 || type === 0xb0 || type === 0xe0) {
        pos += 2;
      } else if (type === 0xc0 || type === 0xd0) {
        pos += 1;
      } else {
        // Unknown/unsupported status — bail out of this track rather than
        // desyncing on the rest of the file.
        break;
      }
    }
    pos = trackEnd;
  }

  notes.sort((a, b) => a.startTick - b.startTick);
  return { format, ticksPerBeat, tempoUsPerBeat, notes };
}

if (typeof module !== "undefined") {
  module.exports = { parseMidiFile };
}
