/**
 * Printer acceptance: the real ROM's LPRINT driver must find a ready
 * printer on port 0xF8 and deliver its bytes. Before the printer
 * existed, the unhandled port read 0xFF ("busy forever") and LPRINT
 * hung the machine — so a printout appearing at all proves the status
 * handshake, and its text proves the data path.
 */

import path from "node:path";
import { describe, it, expect } from "vitest";
import { configuredRom } from "../rom.js";
import { TRS80System } from "../../src/machine/trs80-system.js";

// The ROM from fugloy.mcp.json; null without one, and the suite skips.
const romData = configuredRom("model3");

function bootToReady() {
  const system = new TRS80System({ romData });
  system.cpu.strictMode = true;
  expect(system.bootToCassetteBasic()).toBe(true);
  return system;
}

describe.skipIf(romData === null)("LPRINT through the real ROM", () => {
  it('LPRINT "HELLO" lands on the printer with a carriage return', () => {
    const system = bootToReady();
    system.typeText('LPRINT "HELLO"\n');
    system.runSeconds(0.5);
    expect(system.io.printer.text()).toBe("HELLO\n");
  });

  it("LLIST prints the stored program listing", () => {
    const system = bootToReady();
    system.typeText('10 PRINT "HI"\n');
    system.typeText("LLIST\n");
    system.runSeconds(0.5);
    expect(system.io.printer.text()).toContain('10 PRINT "HI"');
  });
});
