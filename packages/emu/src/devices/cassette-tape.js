/**
 * Model III cassette pulse codec: .cas bytes <-> port-0xFF transition
 * times (CPU T-states).
 *
 * The timing constants were measured from the real ROM's own CSAVE
 * output (scripts/probe-cassette-timing.js):
 *
 *   1500 baud ("H" at Cass?, the Model III default) is a square wave,
 *   one full cycle per bit — half-cycles of ~379 T-states for a 1 and
 *   ~768 for a 0, with the half at a byte boundary stretched ~140 T by
 *   the ROM's bookkeeping (which still classifies correctly: a
 *   stretched 1-half is ~522, a stretched 0-half ~911, and the
 *   threshold sits between at 575).
 *
 *   500 baud ("L") is the Model I scheme: a ~190+190 T pulse pair as
 *   the clock at every 4060 T bit cell, plus an identical data pulse
 *   at mid-cell (+2030) when the bit is 1.
 *
 * Bits are MSB-first. Decoding recovers byte framing by trying all 8
 * bit alignments and keeping the one that shows the longest leader run
 * (0x55 for 1500 baud, 0x00 for 500), so a clipped capture still
 * decodes.
 */

// 1500 baud ("H") half-cycle lengths
const H_SHORT = 379; // a 1 bit
const H_LONG = 768; // a 0 bit
const H_THRESHOLD = 575;

// 500 baud ("L") pulse shape and cell. The byte gap matters: the real
// CSAVE stretches the cell after every byte by ~109 T, and the reader
// is tuned to it — without the gap, the next byte's clock pulse rises
// inside the reader's post-sample latch reset and gets wiped, slipping
// its phase onto data pulses.
const L_PULSE = 189;
const L_CELL = 4061;
const L_HALF = 2042;
// The real CSAVE stretches the cell after every byte while it does its
// bookkeeping — variably, up to a couple hundred T — and the reader
// needs that slack or the next clock pulse rises inside its post-
// sample latch reset and gets wiped. The reader has no timeout, so a
// generously padded gap is strictly safe.
const L_BYTE_GAP = 600;
// The real CSAVE pauses an extra half-cell after the 0xA5 sync byte —
// the reader does its post-sync setup in that window.
const L_SYNC_GAP = 2033;
// A gap from clock-pulse start shorter than this is the mid-cell data
// pulse (a 1); a full-cell gap (even stretched at byte ends) is a 0.
const L_DATA_WINDOW = 3040;
// Transitions closer than this belong to the same physical pulse
const L_PULSE_SPAN = 400;

/** Encode a .cas byte stream as transition times at the given baud. */
export function casToPulses(bytes, baud) {
  return baud === 500 ? encode500(bytes) : encode1500(bytes);
}

function encode1500(bytes) {
  // Wire framing (measured from the ROM): the leader and its 0x7F sync
  // are plain 8-bit; every byte AFTER the sync is preceded by a 0
  // start bit the ROM's byte reader hunts for.
  let syncIdx = -1;
  let i = 0;
  while (i < bytes.length && bytes[i] === 0x55) i++;
  if (i > 0 && bytes[i] === 0x7f) syncIdx = i;

  const times = [0]; // the wave's first edge — halves are edge-to-edge
  let t = 0;
  const cycle = (bit) => {
    const half = bit ? H_SHORT : H_LONG;
    times.push((t += half));
    times.push((t += half));
  };
  for (let k = 0; k < bytes.length; k++) {
    if (syncIdx >= 0 && k > syncIdx) cycle(0); // start bit
    for (let bit = 7; bit >= 0; bit--) cycle((bytes[k] >> bit) & 1);
  }
  return times;
}

function encode500(bytes) {
  // Locate the sync byte (a 0x00 leader run then 0xA5) for its pause
  let syncIdx = -1;
  let i = 0;
  while (i < bytes.length && bytes[i] === 0x00) i++;
  if (i > 0 && bytes[i] === 0xa5) syncIdx = i;

  const times = [];
  let t = 0;
  // A pulse is a rise + a fall: the level sits high for ~190 T. (The
  // OUTPUT side writes three DAC levels, but the reader's comparator
  // sees one positive excursion.)
  const pulse = (at) => times.push(at, at + L_PULSE);
  for (let k = 0; k < bytes.length; k++) {
    for (let bit = 7; bit >= 0; bit--) {
      pulse(t);
      if ((bytes[k] >> bit) & 1) pulse(t + L_HALF);
      t += L_CELL;
    }
    t += L_BYTE_GAP;
    if (k === syncIdx) t += L_SYNC_GAP;
  }
  return times;
}

/**
 * Decode transition times back into bytes, sniffing the baud.
 * @returns {{bytes: Uint8Array, baud: 500|1500}}
 */
export function pulsesToBytes(times) {
  if (!times || times.length < 16) {
    return { bytes: new Uint8Array(0), baud: 1500 };
  }
  const intervals = [];
  for (let i = 1; i < times.length; i++) intervals.push(times[i] - times[i - 1]);

  // 500-baud streams are full of ~190 T intra-pulse gaps; 1500-baud
  // half-cycles never get near that.
  const shorties = intervals.filter((d) => d < 300).length;
  const baud = shorties > intervals.length / 4 ? 500 : 1500;
  if (baud === 500) {
    return { bytes: frame(bits500(times), 0x00, 0xa5).bytes, baud };
  }
  // 1500 baud: cycle pairing depends on which edge starts a bit, and a
  // clipped capture can lose that. Decode both parities and keep the
  // framing the leader+sync scorer likes better.
  const candidates = [0, 1].map((parity) => ({
    parity,
    bits: bits1500(intervals, parity),
  }));
  const framed = candidates.map((c) => ({
    ...c,
    ...frame(c.bits, 0x55, 0x7f),
  }));
  const best = framed[1].score > framed[0].score ? framed[1] : framed[0];
  if (best.syncIndex < 0) {
    return { bytes: best.bytes, baud }; // no sync found: raw 8-bit framing
  }
  // Re-read everything after the sync as start-bit-framed 9-cycle bytes
  const out = Array.from(best.bytes.slice(0, best.syncIndex + 1));
  let p = best.shift + (best.syncIndex + 1) * 8;
  while (p + 9 <= best.bits.length && best.bits[p] === 0) {
    let byte = 0;
    for (let k = 1; k <= 8; k++) byte = (byte << 1) | best.bits[p + k];
    out.push(byte);
    p += 9;
  }
  return { bytes: Uint8Array.from(out), baud };
}

function bits1500(intervals, parity) {
  // Classify FULL cycles (two halves), not halves: the ROM stretches
  // the half at a byte boundary by its bookkeeping time (~230 T),
  // enough to push a stretched 1-half over any half-level threshold,
  // but nowhere near the cycle midpoint (758 vs 1536).
  const bits = [];
  for (let i = parity; i + 1 < intervals.length; i += 2) {
    bits.push(intervals[i] + intervals[i + 1] < 2 * H_THRESHOLD ? 1 : 0);
  }
  return bits;
}

function bits500(times) {
  // Collapse each pulse's internal transitions to its start time
  const starts = [];
  let i = 0;
  while (i < times.length) {
    starts.push(times[i]);
    while (i + 1 < times.length && times[i + 1] - times[i] < L_PULSE_SPAN) i++;
    i++;
  }
  const bits = [];
  let k = 0;
  while (k + 1 < starts.length) {
    if (starts[k + 1] - starts[k] < L_DATA_WINDOW) {
      bits.push(1); // mid-cell data pulse: consume it too
      k += 2;
    } else {
      bits.push(0);
      k += 1;
    }
  }
  // A trailing lone clock pulse is a final 0 bit (a 1 would have had a
  // data pulse after it). Without this, the tape's LAST byte loses its
  // last bit and gets dropped — for BASIC tapes that's the third zero
  // of the end-of-program marker, and CLOAD waits for it forever.
  if (k < starts.length) bits.push(0);
  return bits;
}

/**
 * Pick the bit alignment for byte framing. A repeating leader (0x55
 * alternates, 0x00 is featureless) looks valid at several shifts, so
 * the run length alone can't decide — the shift whose leader run is
 * followed by the real sync byte wins.
 * @returns {{bytes: Uint8Array, score: number, shift: number,
 *            syncIndex: number}} syncIndex is the sync byte's position
 *            (-1 when the leader+sync pattern never showed up)
 */
function frame(bits, leaderByte, syncByte) {
  let best = null;
  for (let shift = 0; shift < 8; shift++) {
    const bytes = packBits(bits, shift);
    let run = 0;
    let maxRun = 0;
    let runEnd = -1;
    const scan = Math.min(bytes.length, 400);
    for (let i = 0; i < scan; i++) {
      if (bytes[i] === leaderByte) {
        run++;
        if (run > maxRun) {
          maxRun = run;
          runEnd = i + 1;
        }
      } else {
        run = 0;
      }
    }
    let score = maxRun;
    let syncIndex = -1;
    if (runEnd >= 0 && runEnd < bytes.length && bytes[runEnd] === syncByte) {
      score += 1000;
      syncIndex = runEnd;
    }
    if (!best || score > best.score) best = { score, bytes, shift, syncIndex };
  }
  return best;
}

function packBits(bits, shift) {
  const out = new Uint8Array(Math.max(0, Math.floor((bits.length - shift) / 8)));
  for (let i = 0; i < out.length; i++) {
    let b = 0;
    for (let k = 0; k < 8; k++) b = (b << 1) | bits[shift + i * 8 + k];
    out[i] = b;
  }
  return out;
}

/**
 * Give a bare byte stream the leader + sync the ROM's CLOAD hunts for
 * (0x55.. 0x7F at 1500 baud, 0x00.. 0xA5 at 500). Streams that already
 * start with leader bytes pass through untouched.
 */
export function ensureLeader(bytes, baud) {
  const leader = baud === 500 ? 0x00 : 0x55;
  const sync = baud === 500 ? 0xa5 : 0x7f;
  if (bytes.length && bytes[0] === leader) return bytes;
  const out = new Uint8Array(255 + 1 + bytes.length);
  out.fill(leader, 0, 255);
  out[255] = sync;
  out.set(bytes, 256);
  return out;
}
