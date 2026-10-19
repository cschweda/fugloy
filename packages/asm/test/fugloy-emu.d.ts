/**
 * The few parts of @fugloy/emu (plain JavaScript, no declarations) the
 * assembler's tests use: the .CMD parser and the Machine facade.
 */
declare module '@fugloy/emu' {
  export function parseCmd(bytes: Uint8Array): { name: string | null; entry: number; blocks: { addr: number; data: Uint8Array }[] };
  export class Machine {
    constructor(opts: { model?: 1 | 3 | 4; roms: { level2: Uint8Array } });
    readonly cpu: { readonly regs: { pc: number } };
    readonly mem: { read(addr: number, len: number): Uint8Array; write(addr: number, bytes: ArrayLike<number>): void };
    readonly video: { text(): string[] };
    readonly load: { cmd(bytes: Uint8Array): { entry: number } };
    run(opts: { cycles?: number }): { reason: string; cycles: number };
  }
}
