import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createWorkbench } from '../app/composables/useWorkbench';
import { createNavigation } from '../app/composables/useNavigation';
import { resolveGoTo } from '../app/utils/goto';

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
    for (const t of ['$4B9E', '4B9Eh', '0x4b9e', '19358']) expect(resolveGoTo(a, t)).toEqual({ ok: true, addr: 0x4b9e });
    expect(resolveGoTo(a, 'l497f')).toEqual({ ok: true, addr: 0x497f });
  });

  it('reads bare hex with a letter in it as an address, after the labels', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    expect(resolveGoTo(a, '4B9E')).toEqual({ ok: true, addr: 0x4b9e });
    expect(resolveGoTo(a, 'c000')).toEqual({ ok: true, addr: 0xc000 });
    // All digits stay decimal, as parseNumber reads them.
    expect(resolveGoTo(a, '4000')).toEqual({ ok: true, addr: 4000 });
    expect(resolveGoTo(a, '1FFFF')).toMatchObject({ ok: false, reason: '1FFFF is past $FFFF.' });
  });

  it('says why it cannot go', async () => {
    const { wb } = await setup();
    const a = wb.session.value!.analysis;
    expect(resolveGoTo(a, '')).toMatchObject({ ok: false });
    expect(resolveGoTo(a, 'NOSUCH')).toMatchObject({ ok: false, reason: expect.stringContaining('NOSUCH') });
    expect(resolveGoTo(a, '$10000')).toMatchObject({ ok: false });
  });
});
