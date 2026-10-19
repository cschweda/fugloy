// @fugloy/emu is plain JavaScript with no declarations. These are the parts the
// site and its tests use (packages/emu/src: index.js, machine/machine.js and
// the loaders); add to them as the site needs more. Only utils/emulator/ and
// the tests import emu (phase 5B's rule).
declare module '@fugloy/emu' {
  export type Model = 1 | 3 | 4;

  /** Known ROM images: SHA-256 (lowercase hex) → a name that starts with its model (`model1-`, `model3-`, `model4-`). */
  export const ROM_HASHES: Readonly<Record<string, string>>;
  /** The CPU clock of model `n`, in Hz. */
  export function clockHz(model: Model): number;
  export const CPU_CLOCK_HZ: number;

  export interface LoadBlock {
    addr: number;
    data: Uint8Array;
  }

  export interface KeyboardMatrix {
    keyDown(key: string, code: string): boolean;
    keyUp(code: string): boolean;
    reset(): void;
  }

  export class TRS80System {
    constructor(options: { romData: Uint8Array });
    cpu: { strictMode: boolean };
    memory: { videoRam: Uint8Array };
    keyboard: KeyboardMatrix;
    bootToCassetteBasic(): boolean;
    runSeconds(seconds: number): number;
    screenText(): string[];
  }

  export type RunResult = { reason: 'cycles' | 'halt' | 'predicate'; cycles: number } | { reason: 'break' | 'watch'; id: number; cycles: number };

  export interface CmdManifest {
    entry: number;
    [key: string]: unknown;
  }

  /** A save state from `m.debug.snapshot()`: plain, serializable data. */
  export interface Snapshot {
    readonly [key: string]: unknown;
  }

  export class Machine {
    constructor(options: { model?: Model; ram?: 4 | 16 | 32 | 48 | 64 | 128; roms: { level2: Uint8Array }; expansion?: boolean; lowercase?: boolean });
    readonly model: Model;
    /** The clock now (the Model 4 can switch it). */
    readonly clockHz: number;
    readonly cycles: number;
    readonly rom: { bytes: number; sha256: string; recognized: string | null };
    readonly system: TRS80System;
    readonly cpu: { readonly regs: { pc: number; sp: number; [reg: string]: number | boolean } };
    readonly mem: { read(addr: number, len: number): Uint8Array; write(addr: number, bytes: Uint8Array): void };
    readonly video: {
      readonly raw: Uint8Array;
      readonly columns: number;
      readonly rows: number;
      /** The Model 4's 80-column layout (port $84 bit 2); false on the other models. */
      readonly wide: boolean;
      /** The Model 4's inverse video (port $84 bit 3); false on the other models. */
      readonly inverse: boolean;
      text(): string[];
    };
    readonly load: { cmd(bytes: Uint8Array): CmdManifest };
    readonly io: { in(port: number): number; out(port: number, value: number): void };
    readonly debug: {
      snapshot(): Snapshot;
      restore(snap: Snapshot): void;
      /** The instruction trace: a ring of the last `depth` instructions run (a halted CPU's idling is not one). */
      readonly trace: {
        enable(opts: { depth: number; regs?: boolean }): void;
        disable(): void;
        clear(): void;
        /** The newest `n` entries, oldest first. */
        last(n: number): { pc: number; bytes: number[]; cycles: number }[];
        readonly enabled: boolean;
      };
    };
    /** Typing through the matrix at `cps` characters a second (default 20). */
    readonly keyboard: { type(text: string, opts?: { cps?: number }): void };
    reset(): void;
    step(n?: number): { cycles: number; halted: boolean };
    run(opts?: { cycles?: number; until?: unknown }): RunResult;
  }

  export function parseCmd(bytes: Uint8Array): { name: string; blocks: LoadBlock[]; entry: number };
  export function fastLoadCmd(system: TRS80System, parsed: ReturnType<typeof parseCmd>): number;
  export function parseCas(bytes: Uint8Array): { kind: 'system'; name: string; blocks: LoadBlock[]; entry: number; checksumErrors: number } | { kind: 'basic'; name: string };
  export function fastLoadSystem(system: TRS80System, parsed: ReturnType<typeof parseCas>): number;
}
