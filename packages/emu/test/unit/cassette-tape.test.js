/**
 * Cassette pulse codec unit tests: bytes -> port-0xFF transition times
 * -> bytes, at both Model III rates. Timing constants were measured
 * from the real ROM's CSAVE output (scripts/probe-cassette-timing.js);
 * the integration tests close the loop through the ROM itself.
 */

import { describe, it, expect } from "vitest";
import {
  casToPulses,
  pulsesToBytes,
  ensureLeader,
} from "../../src/devices/cassette-tape.js";

const SAMPLE = new Uint8Array([
  ...new Array(32).fill(0x55),
  0x7f,
  0xd3, 0xd3, 0xd3, 0x41,
  0x00, 0x2a, 0x0a, 0x00, 0xb2, 0x22, 0x48, 0x49, 0x22, 0x00,
  0x00, 0x00,
]);

describe("1500 baud codec", () => {
  it("round-trips bytes through pulses", () => {
    const pulses = casToPulses(SAMPLE, 1500);
    const decoded = pulsesToBytes(pulses);
    expect(decoded.baud).toBe(1500);
    expect(Array.from(decoded.bytes)).toEqual(Array.from(SAMPLE));
  });

  it("survives a clipped leader (alignment recovery)", () => {
    const pulses = casToPulses(SAMPLE, 1500).slice(37); // drop odd edge count
    const decoded = pulsesToBytes(pulses);
    const text = Array.from(decoded.bytes);
    // The tail must still contain the sync and the program header
    const sync = text.indexOf(0x7f);
    expect(sync).toBeGreaterThanOrEqual(0);
    expect(text.slice(sync + 1, sync + 4)).toEqual([0xd3, 0xd3, 0xd3]);
  });
});

describe("500 baud codec", () => {
  const SAMPLE_L = new Uint8Array([
    ...new Array(32).fill(0x00),
    0xa5,
    0xd3, 0xd3, 0xd3, 0x41, 0x0a, 0x00, 0xff, 0x80, 0x01,
  ]);

  it("round-trips bytes through pulses", () => {
    const pulses = casToPulses(SAMPLE_L, 500);
    const decoded = pulsesToBytes(pulses);
    expect(decoded.baud).toBe(500);
    expect(Array.from(decoded.bytes)).toEqual(Array.from(SAMPLE_L));
  });
});

describe("ensureLeader", () => {
  it("leaves an already-leadered tape alone", () => {
    expect(ensureLeader(SAMPLE, 1500)).toBe(SAMPLE);
  });

  it("prepends leader and sync to a bare byte stream", () => {
    const bare = new Uint8Array([0xd3, 0xd3, 0xd3, 0x41, 0x00, 0x00]);
    const led = ensureLeader(bare, 1500);
    expect(led[0]).toBe(0x55);
    const sync = led.indexOf(0x7f);
    expect(sync).toBeGreaterThan(100); // a real-length leader
    expect(led[sync + 1]).toBe(0xd3);

    const led500 = ensureLeader(bare, 500);
    expect(led500[0]).toBe(0x00);
    expect(led500.indexOf(0xa5)).toBeGreaterThan(100);
  });
});
