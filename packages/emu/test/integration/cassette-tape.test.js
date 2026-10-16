/**
 * Real cassette round-trip acceptance, through the real ROM twice:
 * machine A types a program and CSAVEs it (pulse capture -> decoded
 * bytes), machine B gets those bytes back as a pulse tape and CLOADs
 * it in real time through the port-0xFF input latch, then RUNs it.
 * If the pulse shapes, latch semantics, bit order, or framing were
 * wrong anywhere, the ROM itself would refuse the tape.
 */

import { describe, it, expect } from "vitest";
import { configuredRom, ROM_TEST_TIMEOUT } from "../rom.js";
import { TRS80System } from "../../src/machine/trs80-system.js";
import { casToPulses, pulsesToBytes } from "../../src/devices/cassette-tape.js";
import { parseCas } from "../../src/loaders/cas-format.js";

// The ROM from fugloy.mcp.json; null without one, and the suite skips.
const romData = configuredRom("model3");

// Boot to READY answering Cass? — "" is ENTER (H, 1500 baud), "L" is 500
function bootToReady(cassAnswer) {
  const system = new TRS80System({ romData });
  system.cpu.strictMode = true;
  system.runSeconds(1);
  if (cassAnswer) system.typeText(cassAnswer);
  system.typeText("\n");
  system.runSeconds(0.5);
  system.typeText("\n"); // Memory Size?
  system.runSeconds(2);
  expect(system.screenText().join("\n")).toContain("READY");
  return system;
}

function csaveCapture(system) {
  system.typeText('10 PRINT "TAPE ROUND TRIP"\n');
  system.io.cassette.recordLog = []; // discard key-click transitions
  system.typeText('CSAVE"A"\n');
  system.runSeconds(30); // CSAVE at 500 baud takes a while
  return system.io.cassette.recordedCas();
}

function cloadAndRun(system, tapeBytes, baud) {
  system.io.cassette.insertPulseTape(casToPulses(tapeBytes, baud));
  system.typeText("CLOAD\n");
  system.runSeconds(baud === 1500 ? 10 : 45);
  const afterLoad = system.screenText().join("\n");
  expect(afterLoad).toContain("READY"); // CLOAD finished, not hung
  system.typeText("RUN\n");
  system.runSeconds(1);
  return system.screenText().join("\n");
}

describe.skipIf(romData === null)("CSAVE -> CLOAD round trip through the real ROM", { timeout: ROM_TEST_TIMEOUT }, () => {
  it("works at 1500 baud (the Model III default)", () => {
    const a = bootToReady("");
    const recorded = csaveCapture(a);
    expect(recorded.baud).toBe(1500);

    // The recorded tape is a well-formed BASIC .cas
    const parsed = parseCas(recorded.bytes);
    expect(parsed.kind).toBe("basic");
    expect(parsed.lines).toHaveLength(1);
    expect(parsed.lines[0].lineNo).toBe(10);

    const b = bootToReady("");
    const screen = cloadAndRun(b, recorded.bytes, 1500);
    expect(screen).toContain("TAPE ROUND TRIP");
  });

  it("works at 500 baud (the L answer at Cass?)", () => {
    const a = bootToReady("L");
    const recorded = csaveCapture(a);
    expect(recorded.baud).toBe(500);

    const b = bootToReady("L");
    const screen = cloadAndRun(b, recorded.bytes, 500);
    expect(screen).toContain("TAPE ROUND TRIP");
  });
});
