// The boot snapshot's cache key is the ROM's SHA-256, hashed without building a Machine, so a Run
// that hits the cache builds only the one Machine it runs on. A replaced ROM's snapshot is
// dropped, and a Run writes its .CMD once.
import { describe, expect, it, vi } from 'vitest';

const built = vi.hoisted(() => ({ count: 0, toCmd: 0 }));
vi.mock('@fugloy/emu', async (importOriginal) => {
  const emu = await importOriginal<typeof import('@fugloy/emu')>();
  class Counted extends emu.Machine {
    constructor(...args: ConstructorParameters<typeof emu.Machine>) {
      super(...args);
      built.count++;
    }
  }
  return { ...emu, Machine: Counted };
});
vi.mock('@fugloy/asm', async (importOriginal) => {
  const asm = await importOriginal<typeof import('@fugloy/asm')>();
  return {
    ...asm,
    toCmd: (...args: Parameters<typeof asm.toCmd>) => {
      built.toCmd++;
      return asm.toCmd(...args);
    },
  };
});

const { bootedSnapshot, prepareMachine, snapshotCount } = await import('../app/utils/emulator/boot');
const { stubRom } = await import('../app/utils/emulator/stub-rom');
const { assemble } = await import('@fugloy/asm');
const kit = await import('../app/utils/emulator/kit');

/** A synthetic Model III "ROM" (no ROM bytes) that prints READY and halts; `mark` makes each one different. */
function readyRom(mark: number): Uint8Array {
  const r = assemble(['        ORG 0', '        LD HL,MSG', '        LD DE,3C00H', '        LD BC,5', '        LDIR', 'HERE:   JR HERE', "MSG:    DB 'READY'", `        DB ${mark}`, '        END', ''].join('\n'));
  expect(r.ok).toBe(true);
  const rom = new Uint8Array(0x3800);
  for (const run of r.image!.runs()) rom.set(r.image!.bytes.subarray(run.start, run.end + 1), run.start);
  return rom;
}

describe('bootedSnapshot', () => {
  it('builds a Machine only on a miss, and prepareMachine builds just the one it returns', () => {
    built.count = 0;
    const snap = bootedSnapshot(3, stubRom(3));
    expect(built.count).toBe(1);
    expect(bootedSnapshot(3, stubRom(3).slice())).toBe(snap);
    expect(built.count).toBe(1);
    prepareMachine({ model: 3, rom: stubRom(3), result: assemble('        ORG 7000H\nSTART: JR START\n        END START\n') });
    expect(built.count).toBe(2);
  });

  it("keeps one snapshot per model's ROM: a replaced ROM's is dropped, and the stub's stays", () => {
    const stub = bootedSnapshot(3, stubRom(3));
    const before = snapshotCount();
    const a = readyRom(1);
    const snapA = bootedSnapshot(3, a);
    expect(bootedSnapshot(3, a)).toBe(snapA);
    const count = snapshotCount();
    expect(count).toBe(before + 1);
    const snapB = bootedSnapshot(3, readyRom(2));
    expect(snapB).not.toBe(snapA);
    expect(snapshotCount()).toBe(count);
    // A gone: booting it again is a miss.
    built.count = 0;
    expect(bootedSnapshot(3, a)).not.toBe(snapA);
    expect(built.count).toBe(1);
    expect(bootedSnapshot(3, stubRom(3))).toBe(stub);
  });
});

describe('a Run', () => {
  it('writes the .CMD once, for the listing and the machine both', () => {
    built.toCmd = 0;
    const out = kit.runOnce(kit, { text: '        ORG 7000H\nSTART: JR START\n        END START\n', model: 3, rom: null, runner: { schedule: () => 0, cancel: () => {}, now: () => 0 } });
    expect(out.runner).not.toBeNull();
    expect(out.bytes).not.toBeNull();
    expect(built.toCmd).toBe(1);
  });
});
