/**
 * The program behind fixtures/synthetic/label-file/sample.labels.json, rebuilt here byte for byte
 * from packages/emu/test/unit/label-sample.js so the disassembler's tests do not import the
 * emulator. The fixture's `program.sha256` is the hash of these bytes; a test checks it.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const SAMPLE_LABELS_PATH = fileURLToPath(new URL('../../../fixtures/synthetic/label-file/sample.labels.json', import.meta.url));
export const sampleLabelText = (): string => readFileSync(SAMPLE_LABELS_PATH, 'utf8');

const CODE = new Array<number>(0x40).fill(0);
const place = (addr: number, bytes: number[]): void => { CODE.splice(addr - 0x7000, bytes.length, ...bytes); };
place(0x7000, [0xf3]); //                 DI
place(0x7001, [0x31, 0x00, 0x7f]); //     LD SP,7F00H
place(0x7004, [0x06, 0x03]); //           LD B,3
place(0x7006, [0xcd, 0x20, 0x70]); //     CALL 7020H
place(0x7009, [0x10, 0xfb]); //           DJNZ 7006H
place(0x700b, [0xcf]); //                 RST 08H
place(0x700c, [0x3a, 0x40, 0x70]); //     LD A,(7040H)
place(0x700f, [0x32, 0x41, 0x70]); //     LD (7041H),A
place(0x7012, [0xcd, 0x30, 0x70]); //     CALL 7030H
place(0x7015, [0xcd, 0x30, 0x70]); //     CALL 7030H
place(0x7018, [0x76]); //                 HALT
place(0x7020, [0x21, 0x40, 0x70]); //     LD HL,7040H
place(0x7023, [0x7e]); //                 LD A,(HL)
place(0x7024, [0xc9]); //                 RET
place(0x7030, [0xc3, 0x34, 0x70]); //     JP 7034H
place(0x7034, [0xc9]); //                 RET

/** Name SAMPLE, the code block at $7000, a two-byte data block at $7040, entry $7000. */
export function sampleCmd(): Uint8Array {
  const out: number[] = [0x05, 6, ...[...'SAMPLE'].map((c) => c.charCodeAt(0))];
  for (const r of [{ addr: 0x7000, data: CODE }, { addr: 0x7040, data: [0x12, 0x34] }]) {
    out.push(0x01, (r.data.length + 2) & 0xff, r.addr & 0xff, r.addr >> 8, ...r.data);
  }
  out.push(0x02, 0x02, 0x00, 0x70);
  return Uint8Array.from(out);
}
