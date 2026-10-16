/**
 * TRS-80 Model III line printer (ports 0xF8-0xFB)
 *
 * The parallel printer interface answers status reads and takes data
 * writes on port 0xF8; all four addresses 0xF8-0xFB decode to it.
 * Status 0x30 is "selected, ready" — busy (bit 7) and out-of-paper
 * (bit 6) clear, unit-select (bit 5) and the held-high line (bit 4)
 * set — which is what the ROM's LPRINT driver polls for before every
 * byte. This printer is never busy and never out of paper: bytes land
 * on an in-memory printout the UI offers as a .txt download.
 */

const STATUS_READY = 0x30;

export class Printer {
  constructor() {
    this.bytes = [];
  }

  status() {
    return STATUS_READY;
  }

  write(byte) {
    this.bytes.push(byte & 0xff);
  }

  get length() {
    return this.bytes.length;
  }

  /** The printout as text — the TRS-80 ends lines with 0x0D. */
  text() {
    let out = "";
    for (const b of this.bytes) {
      out += b === 0x0d ? "\n" : String.fromCharCode(b);
    }
    return out;
  }

  clear() {
    this.bytes = [];
  }
}
