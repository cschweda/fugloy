import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorkbench } from '../app/composables/useWorkbench';
import { createNavigation } from '../app/composables/useNavigation';
import { resolveGoTo } from '../app/utils/goto';
import type { Analysis } from '@fugloy/disasm';

const readExample = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(readFileSync(fileURLToPath(new URL(`../../../examples/${path}`, import.meta.url))));
  } catch {
    return null;
  }
};

async function setup() {
  const wb = createWorkbench({ readExample });
  await wb.openExample('sea-dragon');
  const scrolled: number[] = [];
  const nav = createNavigation(wb, (a) => scrolled.push(a));
  wb.cursor.value = 0x497f;
  return { wb, nav, scrolled };
}

describe('navigation', () => {
  it('goTo then back returns to the prior cursor, and forward becomes available', async () => {
    const { wb, nav, scrolled } = await setup();
    expect(nav.canBack.value).toBe(false);
    nav.goTo(0x4b9e);
    expect(wb.cursor.value).toBe(0x4b9e);
    expect(scrolled).toEqual([0x4b9e]);
    expect(nav.canBack.value).toBe(true);
    expect(nav.canForward.value).toBe(false);
    nav.back();
    expect(wb.cursor.value).toBe(0x497f);
    expect(nav.canForward.value).toBe(true);
    expect(nav.canBack.value).toBe(false);
    nav.forward();
    expect(wb.cursor.value).toBe(0x4b9e);
  });

  it('a new jump after going back drops the forward stack; a jump to the same place pushes nothing', async () => {
    const { nav } = await setup();
    nav.goTo(0x4b9e);
    nav.back();
    nav.goTo(0x4b9e);
    nav.back();
    nav.goTo(0x4000);
    expect(nav.canForward.value).toBe(false);
    nav.goTo(0x4000);
    nav.back();
    nav.back();
    expect(nav.canBack.value).toBe(false);
  });

  it('opening another program clears the history', async () => {
    const { wb, nav } = await setup();
    nav.goTo(0x4b9e);
    await wb.openExample('sea-dragon', 'seadrg06.cmd');
    expect(nav.canBack.value).toBe(false);
  });
});

describe('resolveGoTo', () => {
  it('takes addresses in any form and label names in any case', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    for (const t of ['$4B9E', '4B9Eh', '0x4b9e', '4B9E', '4b9e', '#19358']) expect(resolveGoTo(a, t)).toEqual({ ok: true, addr: 0x4b9e });
    expect(resolveGoTo(a, 'l497f')).toEqual({ ok: true, addr: 0x497f });
  });

  it('reads bare hex, all digits included, and decimal only with #', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    expect(resolveGoTo(a, '4000')).toEqual({ ok: true, addr: 0x4000 });
    expect(resolveGoTo(a, '5200')).toEqual({ ok: true, addr: 0x5200 });
    expect(resolveGoTo(a, 'c000')).toEqual({ ok: true, addr: 0xc000 });
    expect(resolveGoTo(a, 'B')).toEqual({ ok: true, addr: 0x000b });
    expect(resolveGoTo(a, '#19358')).toEqual({ ok: true, addr: 0x4b9e });
    expect(resolveGoTo(a, '#16384')).toEqual({ ok: true, addr: 0x4000 });
  });

  it('lets a label spelled like hex win over the address', () => {
    const a = { symbols: { list: () => [{ name: 'CAFE', addr: 0x5123 }] } } as unknown as Analysis;
    expect(resolveGoTo(a, 'cafe')).toEqual({ ok: true, addr: 0x5123 });
    expect(resolveGoTo(a, 'CAFF')).toEqual({ ok: true, addr: 0xcaff });
    // An explicit form is always an address.
    expect(resolveGoTo(a, '$CAFE')).toEqual({ ok: true, addr: 0xcafe });
  });

  it('refuses anything past $FFFF', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    for (const t of ['1FFFF', '10000', '$10000', '10000H', '0x10000', '#65536']) expect(resolveGoTo(a, t)).toEqual({ ok: false, reason: `${t} is past $FFFF.` });
  });

  it('says why it cannot go', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    expect(resolveGoTo(a, '')).toMatchObject({ ok: false });
    expect(resolveGoTo(a, 'NOSUCH')).toEqual({ ok: false, reason: 'No address or label NOSUCH. Type $4B9E, 4B9E, #19358 (decimal), or a label.' });
    expect(resolveGoTo(a, '#4B9E')).toMatchObject({ ok: false, reason: expect.stringContaining('No address or label #4B9E') });
    expect(resolveGoTo(a, '$10000')).toMatchObject({ ok: false });
  });
});
