// The boot snapshot's cache key is the ROM's SHA-256, hashed without building a Machine, so a Run
// that hits the cache builds only the one Machine it runs on.
import { describe, expect, it, vi } from 'vitest';

const built = vi.hoisted(() => ({ count: 0 }));
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

const { bootedSnapshot, prepareMachine } = await import('../app/utils/emulator/boot');
const { stubRom } = await import('../app/utils/emulator/stub-rom');
const { assemble } = await import('@fugloy/asm');

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
});
