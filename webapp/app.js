const MAX_HARDWARE_STEPS = 64; // confirmed device limit, see docs/findings.md

const state = {
  parsed: null,
  baseFileName: null,
  currentBank: 1,
  // "bank_slot" -> { steps, sourceFileName, warnings }
  pending: new Map(),
};

const els = {};

function $(id) { return document.getElementById(id); }

function log(message, isWarning) {
  const p = document.createElement("div");
  p.className = "log-line" + (isWarning ? " warn" : "");
  p.textContent = message;
  els.log.prepend(p);
}

function quantizeMidiToSteps(midi, stepsPerBeat) {
  const stepTicks = midi.ticksPerBeat / stepsPerBeat;
  const stepMap = new Map(); // stepIndex -> [{pitch, velocity}]
  let maxStepIndex = -1;
  let droppedOverflow = 0;

  for (const note of midi.notes) {
    const stepIndex = Math.round(note.startTick / stepTicks);
    if (!stepMap.has(stepIndex)) stepMap.set(stepIndex, []);
    stepMap.get(stepIndex).push({ pitch: note.pitch, velocity: note.velocity });
    if (stepIndex > maxStepIndex) maxStepIndex = stepIndex;
  }

  const warnings = [];
  let totalLength = maxStepIndex + 1;
  if (totalLength > MAX_HARDWARE_STEPS) {
    warnings.push(
      `MIDI-Datei braucht ${totalLength} Steps bei dieser Auflösung, Hardware-Limit ist ${MAX_HARDWARE_STEPS}. ` +
      `Wird auf ${MAX_HARDWARE_STEPS} Steps gekürzt.`
    );
    totalLength = MAX_HARDWARE_STEPS;
  }

  const steps = [];
  for (let i = 0; i < totalLength; i++) {
    let notes = stepMap.get(i) || [];
    if (notes.length > 8) {
      droppedOverflow += notes.length - 8;
      notes = [...notes].sort((a, b) => a.pitch - b.pitch).slice(0, 8);
    }
    steps.push(notes);
  }
  if (droppedOverflow > 0) {
    warnings.push(`${droppedOverflow} Note(n) über dem 8-Noten-pro-Step-Limit wurden verworfen (oberste Noten).`);
  }

  return { steps, warnings };
}

function slotKey(bank, slot) { return `${bank}_${slot}`; }

function slotHasBaseData(bank, slot) {
  if (!state.parsed) return false;
  const blob = state.parsed.blobs.get(slotKey(bank, slot));
  return blob && !isEmptyBlob(blob.bytes);
}

function findAnyPopulatedSlot() {
  if (!state.parsed) return null;
  for (const [key, blob] of state.parsed.blobs) {
    if (!isEmptyBlob(blob.bytes)) {
      const [bank, slot] = key.split("_").map(Number);
      return { bank, slot };
    }
  }
  return null;
}

function renderGrid() {
  els.grid.innerHTML = "";
  for (let slot = 1; slot <= 16; slot++) {
    const cell = document.createElement("div");
    cell.className = "pad";
    const key = slotKey(state.currentBank, slot);
    const pending = state.pending.get(key);
    const hasBase = slotHasBaseData(state.currentBank, slot);

    if (pending) cell.classList.add("pad-pending");
    else if (hasBase) cell.classList.add("pad-has-data");
    else cell.classList.add("pad-empty");

    const title = document.createElement("div");
    title.className = "pad-title";
    title.textContent = `${state.currentBank}.${slot}`;
    cell.appendChild(title);

    const info = document.createElement("div");
    info.className = "pad-info";
    if (pending) {
      info.textContent = `${pending.steps.length} steps\n${pending.sourceFileName}`;
    } else if (hasBase) {
      info.textContent = "belegt";
    } else {
      info.textContent = "leer";
    }
    cell.appendChild(info);

    cell.addEventListener("dragover", (e) => { e.preventDefault(); cell.classList.add("drag-over"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-over"));
    cell.addEventListener("drop", (e) => {
      e.preventDefault();
      cell.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) handleMidiDrop(file, state.currentBank, slot);
    });

    els.grid.appendChild(cell);
  }
}

async function handleMidiDrop(file, bank, slot) {
  if (!state.parsed) {
    log("Erst die Basis-.keystep2-Datei laden, bevor du MIDI-Dateien zuweist.", true);
    return;
  }
  try {
    const buf = new Uint8Array(await file.arrayBuffer());
    const midi = parseMidiFile(buf);
    const stepsPerBeat = parseInt(els.resolution.value, 10);
    const { steps, warnings } = quantizeMidiToSteps(midi, stepsPerBeat);

    state.pending.set(slotKey(bank, slot), { steps, sourceFileName: file.name, warnings });
    log(`${bank}.${slot} <- ${file.name}: ${steps.length} Steps (Auflösung 1/${stepsPerBeat * 4}).`);
    warnings.forEach((w) => log(`${bank}.${slot}: ${w}`, true));
    renderGrid();
  } catch (err) {
    log(`Fehler beim Verarbeiten von ${file.name}: ${err.message}`, true);
  }
}

function handleBaseFile(file) {
  file.arrayBuffer().then((buf) => {
    try {
      const bytes = new Uint8Array(buf);
      const binaryString = bytesToBinaryString(bytes);
      state.parsed = parseKeystep2(binaryString);
      state.baseFileName = file.name;
      state.pending.clear();
      log(`Basisdatei geladen: ${file.name} (${state.parsed.blobs.size} Slots gefunden).`);
      els.downloadBtn.disabled = false;
      renderGrid();
    } catch (err) {
      log(`Konnte ${file.name} nicht als .keystep2 lesen: ${err.message}`, true);
    }
  });
}

function buildDownload() {
  if (!state.parsed) return;
  if (state.pending.size === 0) {
    log("Keine Änderungen zum Speichern — zieh zuerst eine MIDI-Datei auf einen Slot.", true);
    return;
  }

  const patches = [];
  for (const [key, pending] of state.pending) {
    const [bank, slot] = key.split("_").map(Number);
    const blobInfo = state.parsed.blobs.get(key);
    let templateBytes = blobInfo.bytes;
    let newScalarLines = [];

    if (isEmptyBlob(blobInfo.bytes)) {
      const source = findAnyPopulatedSlot();
      if (!source) {
        log(`${bank}.${slot} ist leer und es gibt keinen belegten Slot als Vorlage — übersprungen.`, true);
        continue;
      }
      templateBytes = state.parsed.blobs.get(slotKey(source.bank, source.slot)).bytes;
      newScalarLines = cloneScalarsForSlot(state.parsed, source.bank, source.slot, bank, slot);
      log(
        `${bank}.${slot} war leer: Header/Settings von Slot ${source.bank}.${source.slot} als Vorlage ` +
        `übernommen (experimentell, siehe docs/findings.md).`,
        true
      );
    }

    const blobBytes = buildBlob(templateBytes, pending.steps);
    patches.push({ bank, slot, blobBytes, newScalarLines });
  }

  const newBinaryString = applyPatches(state.parsed, patches);
  const newBytes = binaryStringToBytes(newBinaryString);
  const blob = new Blob([newBytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = state.baseFileName.replace(/\.keystep2$/i, "") + "-modified.keystep2";
  a.click();
  URL.revokeObjectURL(url);
  log(`Datei erzeugt: ${a.download}. Über MIDI Control Center importieren und "Store To" aufs Gerät schreiben.`);
}

function initBankTabs() {
  els.bankTabs.innerHTML = "";
  for (let bank = 1; bank <= 4; bank++) {
    const btn = document.createElement("button");
    btn.textContent = `Bank ${bank}`;
    btn.className = "bank-tab" + (bank === state.currentBank ? " active" : "");
    btn.addEventListener("click", () => {
      state.currentBank = bank;
      [...els.bankTabs.children].forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      renderGrid();
    });
    els.bankTabs.appendChild(btn);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  els.grid = $("grid");
  els.bankTabs = $("bank-tabs");
  els.log = $("log");
  els.resolution = $("resolution");
  els.downloadBtn = $("download-btn");
  els.baseDrop = $("base-drop");
  els.baseInput = $("base-input");

  initBankTabs();
  renderGrid();

  els.downloadBtn.addEventListener("click", buildDownload);

  els.baseDrop.addEventListener("dragover", (e) => { e.preventDefault(); els.baseDrop.classList.add("drag-over"); });
  els.baseDrop.addEventListener("dragleave", () => els.baseDrop.classList.remove("drag-over"));
  els.baseDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    els.baseDrop.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) handleBaseFile(file);
  });
  els.baseInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) handleBaseFile(file);
  });
});
