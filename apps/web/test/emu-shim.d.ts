// @fugloy/emu is plain JavaScript with no declarations; these are the few
// parts test/emulator-run.test.ts uses (packages/emu/src).
declare module '@fugloy/emu' {
  export const CPU_CLOCK_HZ: number;
  export interface LoadBlock {
    addr: number;
    data: Uint8Array;
  }
  export class TRS80System {
    constructor(options: { romData: Uint8Array });
    cpu: { strictMode: boolean };
    memory: { videoRam: Uint8Array };
    keyboard: { keyDown(key: string, code: string): boolean; keyUp(code: string): void };
    bootToCassetteBasic(): boolean;
    runSeconds(seconds: number): number;
    screenText(): string[];
  }
  export function parseCmd(bytes: Uint8Array): { name: string; blocks: LoadBlock[]; entry: number };
  export function fastLoadCmd(system: TRS80System, parsed: ReturnType<typeof parseCmd>): number;
  export function parseCas(bytes: Uint8Array): { kind: 'system'; name: string; blocks: LoadBlock[]; entry: number; checksumErrors: number } | { kind: 'basic'; name: string };
  export function fastLoadSystem(system: TRS80System, parsed: ReturnType<typeof parseCas>): number;
}
