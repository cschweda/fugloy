/**
 * TRS-80 Model III Cassette Interface
 *
 * Two personalities share this deck:
 *
 *   - The byte-level tape (tapeData/readByte/simulate*) that the fast
 *     loaders and legacy phase consoles use.
 *
 *   - The pulse-level deck for the REAL port-0xFF path: a pulse tape
 *     (transition times from cassette-tape.js) plays against the CPU
 *     clock while the ROM holds the motor relay on, setting the input
 *     latch on every transition; any port-0xFF write clears the latch
 *     (the Model III's latch circuit). Output transitions written
 *     while the motor runs are recorded, and recordedCas() decodes
 *     them back into a .cas byte stream — a real CSAVE capture.
 */

import { pulsesToBytes } from "./cassette-tape.js";

export class CassetteSystem {
  constructor() {
    // Where load and save notes go; a no-op unless the host sets one.
    this.log = () => {};
    this.motorOn = false;
    this.playing = false;
    this.recording = false;

    this.tapeData = null;
    this.tapePosition = 0;
    this.tapeLength = 0;

    // Pulse deck: playback
    this.pulseTape = null; // transition times (tape-relative T-states)
    this.pulsePos = 0;
    this.playClock = 0; // tape time elapsed while the motor has been on
    this.lastCycle = 0;
    this.inputLevel = false; // the square wave's current polarity (bit 0)
    this.pulseLatch = false; // rising-edge latch (bit 7, OUT-0xFF resets)
    this.risePending = false; // edges since last consume, by direction
    this.fallPending = false;

    // Pulse deck: recording (port-0xFF output transitions, cycle-stamped)
    this.recordLog = [];
    this.RECORD_LIMIT = 400000;
    this.restoredRecording = null; // decoded bytes carried in by a save state
    // The pulse codec (cassette-tape.js) counts Model III T-states; a machine
    // with another clock (the Model I) sets this to the Model III's clock over
    // its own, so a recording decodes at the times it took in real time.
    this.timeScale = 1;

    this.BUFFER_ADDRESS = 0x4300;
    this.BUFFER_SIZE = 256;

    this.onLoadComplete = null;
    this.onSaveComplete = null;
  }

  /** Advance the playback clock to `cycles`, playing due transitions:
   * each one flips the input level and marks an edge event. */
  _advance(cycles) {
    if (this.motorOn && cycles > this.lastCycle) {
      this.playClock += cycles - this.lastCycle;
    }
    this.lastCycle = cycles;
    if (this.pulseTape && this.motorOn) {
      while (
        this.pulsePos < this.pulseTape.length &&
        this.pulseTape[this.pulsePos] <= this.playClock
      ) {
        this.pulsePos++;
        this.inputLevel = !this.inputLevel;
        if (this.inputLevel) {
          this.risePending = true;
          this.pulseLatch = true;
        } else {
          this.fallPending = true;
        }
      }
    }
  }

  /** Mount a pulse tape (casToPulses output), rewound. */
  insertPulseTape(times) {
    this.pulseTape = times;
    this.pulsePos = 0;
    this.playClock = 0;
    this.inputLevel = false;
    this.pulseLatch = false;
    this.risePending = false;
    this.fallPending = false;
  }

  rewindPulseTape() {
    this.pulsePos = 0;
    this.playClock = 0;
    this.inputLevel = false;
    this.pulseLatch = false;
    this.risePending = false;
    this.fallPending = false;
  }

  /** The tape signal's current level (port 0xFF bit 0). */
  tapeLevel(cycles) {
    this._advance(cycles);
    return this.inputLevel;
  }

  /** Any OUT (0xFF) resets the pulse latch (the 500-baud reader's ack). */
  clearPulseLatch(cycles) {
    this._advance(cycles);
    this.pulseLatch = false;
  }

  /** Edge events since the last consume, by direction. */
  consumeEdges(cycles) {
    this._advance(cycles);
    const edges = { rise: this.risePending, fall: this.fallPending };
    this.risePending = false;
    this.fallPending = false;
    return edges;
  }

  /** Log an output level change while the motor runs (CSAVE's tape). */
  recordTransition(cycles, level) {
    if (!this.motorOn) return;
    if (this.recordLog.length < this.RECORD_LIMIT) {
      this.recordLog.push({ t: cycles, level });
    }
  }

  /**
   * Decode whatever CSAVE recorded into .cas bytes.
   * @returns {{bytes: Uint8Array, baud: 500|1500|null}}
   */
  recordedCas() {
    if (this.recordLog.length) {
      return pulsesToBytes(this.recordLog.map((r) => r.t * this.timeScale));
    }
    if (this.restoredRecording) {
      return { bytes: this.restoredRecording, baud: null };
    }
    return { bytes: new Uint8Array(0), baud: null };
  }

  /** Playback position 0..1, or null when no pulse tape is mounted. */
  progress() {
    return this.pulseTape?.length ? this.pulsePos / this.pulseTape.length : null;
  }

  loadTape(programData) {
    if (!programData || programData.length === 0) {
      return false;
    }

    this.tapeData =
      programData instanceof Uint8Array
        ? programData
        : new Uint8Array(programData);

    this.tapePosition = 0;
    this.tapeLength = this.tapeData.length;

    this.log("info", `Cassette loaded: ${this.tapeLength} bytes`);
    return true;
  }

  simulateCLoad(memory, targetAddress = 0x4200) {
    if (!this.tapeData) {
      this.log("error", "No tape loaded");
      return false;
    }

    for (let i = 0; i < this.tapeLength; i++) {
      memory.writeByte(targetAddress + i, this.tapeData[i]);
    }

    this.log("info",
      `CLOAD: ${this.tapeLength} bytes at 0x${targetAddress.toString(16)}`
    );

    if (this.onLoadComplete) {
      this.onLoadComplete(targetAddress, this.tapeLength);
    }

    return targetAddress;
  }

  simulateCSave(memory, startAddress, length) {
    this.tapeData = new Uint8Array(length);

    for (let i = 0; i < length; i++) {
      this.tapeData[i] = memory.readByte(startAddress + i);
    }

    this.tapePosition = 0;
    this.tapeLength = length;

    this.log("info", `CSAVE: ${length} bytes from 0x${startAddress.toString(16)}`);

    if (this.onSaveComplete) {
      this.onSaveComplete(this.tapeData);
    }

    return this.tapeData;
  }

  getStatus() {
    let status = 0x00;

    if (this.motorOn) status |= 0x01;
    if (this.playing) status |= 0x02;
    if (this.recording) status |= 0x04;
    if (this.tapeData && this.tapePosition < this.tapeLength) {
      status |= 0x08;
    }

    return status;
  }

  control(value, cycles = 0) {
    this._advance(cycles); // settle the old motor state's clock first
    this.motorOn = (value & 0x01) !== 0;

    if (this.motorOn) {
      this.playing = (value & 0x02) !== 0;
      this.recording = (value & 0x04) !== 0;
    } else {
      this.playing = false;
      this.recording = false;
    }
  }

  readByte() {
    if (!this.tapeData || this.tapePosition >= this.tapeLength) {
      return 0x00;
    }
    return this.tapeData[this.tapePosition++];
  }

  rewind() {
    this.tapePosition = 0;
  }

  eject() {
    this.tapeData = null;
    this.tapePosition = 0;
    this.tapeLength = 0;
    this.pulseTape = null;
    this.pulsePos = 0;
    this.playClock = 0;
    this.inputLevel = false;
    this.pulseLatch = false;
    this.risePending = false;
    this.fallPending = false;
    this.motorOn = false;
    this.playing = false;
    this.recording = false;
    // The recording is the recorder's own cassette — eject leaves it
  }
}



