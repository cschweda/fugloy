import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorkbench } from '../app/composables/useWorkbench';
import { callersOf, usesOf } from '../app/utils/xrefs';

const readExample = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url))));
  } catch {
    return null;
  }
};

async function seadragon() {
  const wb = createWorkbench({ readExample });
  await wb.openExample('sea-dragon');
  return wb;
}

describe('usesOf', () => {
  it('lists the rows that use port $EC, with the row text', async () => {
    const wb = await seadragon();
    const uses = usesOf(wb.session.value!.analysis, wb.rows.value, { kind: 'port', key: 0xec });
    expect(uses.map((u) => u.addr)).toContain(0x499f);
    expect(uses.find((u) => u.addr === 0x499f)!.text).toMatch(/^(IN|OUT)\b/);
  });

  it('finds the uses of a program label by address, and none for an unused address', async () => {
    const wb = await seadragon();
    const a = wb.session.value!.analysis;
    const x = a.pass1.xrefs.find((r) => r.kind === 'call' && a.symbols.has(r.to))!;
    expect(usesOf(a, wb.rows.value, { kind: 'addr', key: x.to }).map((u) => u.addr)).toContain(x.from);
    expect(usesOf(a, wb.rows.value, { kind: 'addr', key: 0xfffe })).toEqual([]);
  });

  it('does not mistake a port for an address of the same number', async () => {
    const wb = await seadragon();
    const a = wb.session.value!.analysis;
    const ports = usesOf(a, wb.rows.value, { kind: 'port', key: 0xec }).map((u) => u.addr);
    const addrs = usesOf(a, wb.rows.value, { kind: 'addr', key: 0xec }).map((u) => u.addr);
    expect(addrs.filter((x) => ports.includes(x))).toEqual([]);
  });
});

describe('callersOf', () => {
  it('counts an rst as a caller, not a jumper', () => {
    // RST 10H; RST 18H; RET, as a raw program at $7000.
    const wb = createWorkbench({ readExample });
    wb.openBytes(Uint8Array.from([0xd7, 0xdf, 0xc9]), 'rst.bin', { base: 0x7000 });
    const a = wb.session.value!.analysis;
    const rsts = a.pass1.xrefs.filter((r) => r.kind === 'rst');
    expect(rsts.map((r) => [r.from, r.to])).toEqual([
      [0x7000, 0x10],
      [0x7001, 0x18],
    ]);
    expect(callersOf(a, 0x10)).toEqual({ callers: [0x7000], jumpers: [] });
  });

  it('lists callers ascending without duplicates, and counts an rst as a call', async () => {
    const wb = await seadragon();
    const a = wb.session.value!.analysis;
    const call = a.pass1.xrefs.find((r) => r.kind === 'call')!;
    const groups = callersOf(a, call.to);
    expect(groups.callers).toContain(call.from);
    expect(groups.callers).toEqual([...groups.callers].sort((p, q) => p - q));
    expect(new Set(groups.callers).size).toBe(groups.callers.length);
    expect(groups.jumpers).toEqual([...groups.jumpers].sort((p, q) => p - q));
    const jump = a.pass1.xrefs.find((r) => r.kind === 'jump' || r.kind === 'cjump');
    expect(jump).toBeDefined();
    expect(callersOf(a, jump!.to).jumpers).toContain(jump!.from);
  });
});
