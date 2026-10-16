/**
 * Line printer unit tests: the port-0xF8 peripheral itself, and its
 * IOSystem wiring (ports 0xF8-0xFB all decode to the printer; status
 * reads 0x30 "selected, ready"; the printout survives a reset the way
 * paper in a real printer does).
 */

import { describe, it, expect } from "vitest";
import { Printer } from "../../src/devices/printer.js";
import { IOSystem } from "../../src/machine/io.js";

describe("Printer", () => {
  it("starts empty and ready", () => {
    const p = new Printer();
    expect(p.length).toBe(0);
    expect(p.status()).toBe(0x30);
    expect(p.text()).toBe("");
  });

  it("captures written bytes and renders 0x0D as a newline", () => {
    const p = new Printer();
    for (const b of [0x48, 0x49, 0x0d]) p.write(b);
    expect(p.length).toBe(3);
    expect(p.text()).toBe("HI\n");
  });

  it("clear() empties the printout", () => {
    const p = new Printer();
    p.write(0x41);
    p.clear();
    expect(p.length).toBe(0);
    expect(p.text()).toBe("");
  });
});

describe("IOSystem printer ports", () => {
  it("routes writes on 0xF8-0xFB to the printer", () => {
    const io = new IOSystem();
    io.writePort(0xf8, 0x41);
    io.writePort(0xf9, 0x42);
    io.writePort(0xfa, 0x43);
    io.writePort(0xfb, 0x0d);
    expect(io.printer.text()).toBe("ABC\n");
  });

  it("reads ready status 0x30 on all four printer ports", () => {
    const io = new IOSystem();
    for (const port of [0xf8, 0xf9, 0xfa, 0xfb]) {
      expect(io.readPort(port)).toBe(0x30);
    }
  });

  it("keeps the printout across a reset (paper survives a reboot)", () => {
    const io = new IOSystem();
    io.writePort(0xf8, 0x41);
    io.reset();
    expect(io.printer.text()).toBe("A");
  });
});
