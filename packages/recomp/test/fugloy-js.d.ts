/**
 * The parts of the plain-JavaScript packages (no declarations of their own) that recomp's tests use:
 * emu's bare Z80 core, and the runtime's machine state and helpers. The '@fugloy/emu' block merges
 * with packages/asm/test/fugloy-emu.d.ts, which declares the Machine facade.
 */
declare module '@fugloy/emu' {
  export class Z80CPU {
    /** The 8-bit registers by name (A, F, ..., A_, F_, ..., IXH, I, R), and SP and PC. */
    registers: Record<string, number>;
    wz: number;
    cycles: number;
    IFF1: boolean;
    IFF2: boolean;
    interruptMode: number;
    halted: boolean;
    pendingEI: number;
    /** True when the instruction just run wrote the flags (Q, for SCF and CCF). */
    flagsWritten: boolean;
    strictMode: boolean;
    readMemory: (addr: number) => number;
    writeMemory: (addr: number, value: number) => void;
    readPort: (port: number) => number;
    writePort: (port: number, value: number) => void;
    reset(): void;
    executeInstruction(): number;
  }
}

declare module '@fugloy/runtime' {
  export class Z {
    a: number; f: number; b: number; c: number; d: number; e: number; h: number; l: number;
    i: number; r: number; ixh: number; ixl: number; iyh: number; iyl: number;
    sp: number; wz: number; af_: number; bc_: number; de_: number; hl_: number;
    af: number; bc: number; de: number; hl: number; ix: number; iy: number;
    iff1: boolean; iff2: boolean; im: number; q: number;
    cycles: number;
    mem: Uint8Array;
    tick(t: number, r: number): void;
    read(addr: number): number;
    write(addr: number, v: number): void;
    in(port: number): number;
    out(port: number, v: number): void;
  }
  export function createZ(opts: { model: 1 | 3 | 'flat' }): Z;
}

declare module '@fugloy/runtime/ops' {
  export {};
}
