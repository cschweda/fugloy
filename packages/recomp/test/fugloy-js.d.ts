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
  /** Merges with the Machine packages/asm/test/fugloy-emu.d.ts declares: its system, step and live video RAM. */
  export interface Machine {
    readonly system: {
      readonly cpu: Z80CPU;
      /** A read with no device side effect (memory.js, peekByte). */
      readonly memory: { peekByte(addr: number): number };
      /** The ports (machine/io.js): `modeRegister` is port $EC's latch on the Model III, port $FF's D0-D3 on the Model I. */
      readonly io: { modeRegister: number };
    };
    step(n?: number): { cycles: number; halted: boolean };
    /** T-states since the last reset. */
    readonly cycles: number;
    /** `until` as a function too: checked after each instruction (M2's sessions run to a block start with it). */
    run(opts: { cycles?: number; until?: 'halt' | ((m: Machine) => boolean) }): { reason: string; cycles: number };
    /** The debugger parts the census (tools/census.ts) uses: the memory hooks and coverage (debug/debugger.js). */
    readonly debug: {
      readonly hooks: {
        /** Each data read (never an instruction fetch), with the start of the instruction making it. */
        onMemRead: ((addr: number, value: number, pc: number) => void) | null;
        /** Each memory write, with the byte it replaced and the start of the instruction making it. */
        onMemWrite: ((addr: number, value: number, prev: number, pc: number) => void) | null;
      };
      readonly coverage: { enable(): void; disable(): void; readonly bits: Uint8Array };
    };
    /** Every write to port $FF, raw, in a ring of the newest 65,536 (devices/sound.js), which the referee compares. */
    readonly sound: {
      events(sinceCycle?: number): { cycle: number; value: number }[];
      clear(): void;
      /** Writes lost to wrap-around since the last clear. */
      readonly overflowed: number;
    };
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
    /** The mode register: port $EC's latch on the Model III, port $FF's D0-D3 on the Model I. */
    modeRegister: number;
    mem: Uint8Array;
    /** The write guard `load` installs: 1 at each code byte a write throws at; null when none is installed. */
    guard: Uint8Array | null;
    /** Every write to port $FF, as { t: the T-state, v: the byte }; the host drains it. */
    sound: { t: number; v: number }[];
    /** The address the last block began with (the default `at` records it). */
    block: number;
    at(addr: number): void;
    tick(t: number, r: number): void;
    read(addr: number): number;
    write(addr: number, v: number): void;
    read16(addr: number): number;
    write16(addr: number, v: number): void;
    in(port: number): number;
    out(port: number, v: number): void;
    readonly model: 1 | 3 | 'flat';
    /** Where the ROM space ends: the first address past it ($3000 on the Model I, $3800 on the Model III). */
    readonly romTop: number;
    readonly clockHz: number;
    readonly columns32: boolean;
    press(name: string): void;
    release(name: string): void;
  }
  export function createZ(opts: { model: 1 | 3 | 'flat' }): Z;
  /** A port module, as @fugloy/recomp's port() writes it. */
  export type Routine = (z: Z, ret: number) => Routine | undefined;
  export interface PortModule {
    readonly MODEL: 1 | 3;
    readonly DATA: readonly (readonly [number, Uint8Array])[];
    /** The program's code as [first, last] addresses: none of its bytes is carried. */
    readonly CODE?: readonly (readonly [number, number])[];
    /** The code bytes the program rewrites, as [address, byte as loaded]. */
    readonly CELLS?: readonly (readonly [number, number])[];
    /** The ROM bytes the program reads as data, as [address, byte]: `load` puts them in memory. */
    readonly ROM?: readonly (readonly [number, number])[];
    readonly ENTRY: Routine;
  }
  export function load(z: Z, mod: PortModule): void;
  /** A ROM routine the runtime stands in for (rom.js). */
  export interface Standin {
    readonly name: string;
    run(z: Z): void;
  }
  export function standins(model: 1 | 3): ReadonlyMap<number, Standin>;
  /** The Model III's stand-ins as Z80 source for @fugloy/asm, at the ROM's addresses, with no END. */
  export const STANDINS_Z: string;
  export function runPort(z: Z, mod: PortModule): { reason: 'returned' };
}

declare module '@fugloy/runtime/ops' {
  export {};
}

/** The browser player's loop (M2 Task 9, src/player/), which test/player.test.ts runs headlessly. */
declare module '@fugloy/runtime/player' {
  import type { PortModule } from '@fugloy/runtime';
  /** What the worker posts at each frame (frame.js). */
  export interface FrameMessage {
    type: 'frame';
    frame: number;
    from: number;
    to: number;
    cycles: number;
    video: Uint8Array;
    sound: { t: number; v: number }[];
    mode: number;
  }
  /** Where a standalone port starts: SP, the return address pushed there, and any registers. */
  export interface Start {
    sp?: number; ret?: number;
    a?: number; f?: number; b?: number; c?: number; d?: number; e?: number; h?: number; l?: number;
    i?: number; r?: number; ix?: number; iy?: number; wz?: number; q?: number;
    af_?: number; bc_?: number; de_?: number; hl_?: number;
  }
  export const START: Readonly<Start>;
  export function play(opts: {
    mod: PortModule;
    keys: Uint8Array;
    counter?: Int32Array | null;
    post: (message: FrameMessage, transfer: ArrayBuffer[]) => void;
    wait: (ms: number) => void;
    now: () => number;
    start?: Start;
  }): { reason: 'returned' };
}
