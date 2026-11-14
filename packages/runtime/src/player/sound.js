/**
 * The player's sound (M2): a port's writes to port $FF turned into samples, and when to play each frame's.
 * No DOM: page.js hands the samples to WebAudio.
 *
 * The Model I's and III's only sound is the cassette output, port $FF's bits 0-1 (@fugloy/emu's port map,
 * packages/emu/src/machine/io.js:17, "write bits 0-1 = output level"; docs/fugloy-emu-spec.md §5's table,
 * "Port FF bits 0-1 out"). `m.sound` and the runtime's `z.sound` keep every write raw, with its T-state.
 * The two bits drive a three-level network, as the Model I's technical manual gives it and xtrs plays it
 * (trs_cassette.c, `value_to_sample`): 0 the middle level (0.46 V), 1 the high (0.85 V), 2 the low (0 V),
 * and 3, unused, about the middle. Here the middle is 0 and the others +1 and -1.
 */

/** The level each value of bits 0-1 gives: 0 the middle, 1 high, 2 low, 3 (unused) the middle. */
const LEVEL = [0, 1, -1, 0];

/**
 * The sample a T-state falls in: `floor(t * sampleRate / clockHz)`. Every position is derived from an
 * absolute T-state, never from the frame before, so frames tile with no rounding error carried.
 * @param {number} t
 * @param {number} clockHz
 * @param {number} sampleRate
 */
const sampleOf = (t, clockHz, sampleRate) => Math.floor((t * sampleRate) / clockHz);

/**
 * The square wave the cassette port's writes make from T-state `from` to T-state `to`: the samples
 * `sampleOf(from)` up to (not including) `sampleOf(to)`, each the level of the last write at or before its
 * time (the level between two writes is the earlier write's). `records` are `z.sound`'s `{ t, v }`, oldest
 * first; one before `from` (the previous frame's last write) gives the level the frame starts at. With no
 * write at all the frame is silent (all 0).
 * @param {readonly { t: number, v: number }[]} records
 * @param {number} from
 * @param {number} to
 * @param {number} clockHz
 * @param {number} sampleRate
 * @returns {Float32Array<ArrayBuffer>}
 */
export function samples(records, from, to, clockHz, sampleRate) {
  const first = sampleOf(from, clockHz, sampleRate);
  const out = new Float32Array(Math.max(0, sampleOf(to, clockHz, sampleRate) - first));
  let level = 0;
  let k = 0;
  // The level the frame starts at: the last write before its first sample
  while (k < records.length && sampleOf(records[k].t, clockHz, sampleRate) <= first) level = LEVEL[records[k++].v & 3];
  for (let i = 0; i < out.length; i++) {
    while (k < records.length && sampleOf(records[k].t, clockHz, sampleRate) <= first + i) level = LEVEL[records[k++].v & 3];
    out[i] = level;
  }
  return out;
}

/**
 * How far ahead of the audio clock a frame's samples are scheduled, in seconds: enough that a frame posted
 * a little late still joins the one before without a gap.
 */
export const LEAD_S = 0.05;
/**
 * The most audio may be queued ahead of the audio clock, in seconds. When the game's clock runs ahead of
 * the audio clock (the two crystals differ, or the worker catches up after a slow frame), a frame that
 * would start later than this is dropped, so the delay between a key and its sound never grows.
 */
export const MAX_LATENCY_S = 0.2;

/**
 * When to play each frame's samples: right after the frame before, so frames join without clicks. A frame
 * that would start in the past (the audio ran dry: the page was busy, or the game stalled) starts `lead`
 * from now, leaving a gap; one that would start more than `maxLatency` from now is dropped (`next` returns
 * -1) and the queue left as it was.
 * @param {{ lead?: number, maxLatency?: number }} [opts] in seconds
 */
export function createAudioSchedule({ lead = LEAD_S, maxLatency = MAX_LATENCY_S } = {}) {
  let end = 0;
  return {
    /**
     * The audio-clock time to start a frame of `duration` seconds, given the audio clock `now`; -1 to drop it.
     * @param {number} now
     * @param {number} duration
     * @returns {number}
     */
    next(now, duration) {
      let at = end;
      if (at < now) at = now + lead;
      if (at > now + maxLatency) return -1;
      end = at + duration;
      return at;
    },
  };
}
