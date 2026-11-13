/**
 * @fugloy/runtime/screen, M2 Task 8: the TRS-80 screen drawn into an RGBA buffer, one renderer for the
 * workbench and the ports. It moved here from apps/web/app/utils/emulator/screen.ts, and the move
 * changes no pixel: each case below renders a video RAM holding every byte value once (at every
 * address in 64 and 80 columns, at every even address in 32 and 40, where only those show) and
 * compares the buffer's SHA-256 with the hash the web app's renderer gave for the same input before
 * the move (computed at commit 549ddfb, through tsx, from apps/web/app/utils/emulator/screen.ts and
 * glyphs.generated.ts). The glyph tables' bytes are pinned the same way.
 *
 * screenOf(z) is a port's counterpart of the web app's screenView(m): the same view, from the
 * runtime's model and mode register, compared with what screenView reads from an emulator (its
 * m.video fields and model; the web app's screenView is that object) after the same writes.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Machine } from '@fugloy/emu';
import { describe, expect, it } from 'vitest';
import { createZ } from '../src/index.js';
import {
  CG_MODEL1,
  CG_MODEL1_LOWERCASE,
  CG_MODEL3,
  CG_MODEL4,
  MODEL1_ASPECT,
  MODEL3_ASPECT,
  SCREEN_BG,
  SCREEN_FG,
  panelFit,
  renderNotice,
  renderScreen,
  screenOf,
  screenSize,
  tubeAspect,
  tubeFit,
} from '../src/screen.js';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** 2K of spaces with byte k (0-255) at address k * step: every value once, where the view shows it. */
function everyByte(step) {
  const raw = new Uint8Array(2048).fill(0x20);
  for (let k = 0; k < 256; k++) raw[k * step] = k;
  return raw;
}

function draw(raw, view) {
  const { width, height } = screenSize(view);
  const out = new Uint8ClampedArray(width * height * 4);
  expect(renderScreen(raw, view, out, width)).toBe(true);
  return { out, size: `${width}x${height}` };
}

const M3 = { columns: 64, rows: 16, wide: false, inverse: false, font: 'model3', altCharset: false };

/** [name, step, view, size, the web app renderer's SHA-256 at 549ddfb]. */
const PINS = [
  ['Model III', 1, M3, '512x192', 'c7cc98c71d43113b802d7f3dc79ac4d9af576f91641dbe86f0bbfdbe106e1484'],
  ['Model III, the alternate set', 1, { ...M3, altCharset: true }, '512x192', '6161771b61523fb1e7a27d0543d9d31a56a09a875e7ccd015fb4ef3962ca8305'],
  ['Model III, 32 columns', 2, { ...M3, columns: 32 }, '512x192', '369c2e46bd2ad67c2d092faab440b96fb05163b8d64b9293e5059ec14e694fbd'],
  ['Model III, 32 columns, the alternate set', 2, { ...M3, columns: 32, altCharset: true }, '512x192', '9ba6547987f4d1ba0695fb6d837cdb83b5ae4835e257b435460e568529a1c47b'],
  ['Model I', 1, { ...M3, font: 'model1' }, '384x192', '0610b8343ae1e3d08d337a68d551d47a8ea3beafe719962e8250eb205ae7e6df'],
  ['Model I, 32 columns', 2, { ...M3, font: 'model1', columns: 32 }, '384x192', '7bd494f94eda25a9e541ce8a66fff082d60a1e26b66c2d2ec022dda6e144e052'],
  ['Model I, the lowercase kit', 1, { ...M3, font: 'model1-lowercase' }, '384x192', '3d0b61bbdb5755f527c2d4638a5af179880903cc450da148620647c43e1532b5'],
  ['Model 4, 64x16', 1, { ...M3, font: 'model4' }, '512x192', 'e8b6be406e32e4df69786942de3ddcb93659fe65160cc278fdde193b3ca8e664'],
  ['Model 4, 64x16, the alternate set', 1, { ...M3, font: 'model4', altCharset: true }, '512x192', '64e55c1bec23ba751671a1cd67385abfe3ae382f976b3aa4611fab4e2611751a'],
  ['Model 4, 80x24', 1, { ...M3, font: 'model4', columns: 80, rows: 24, wide: true }, '640x240', '1fc5cc25e7cd5aa6d97fcbb293ef2fa67849000ccb503b682f700941db9e7523'],
  ['Model 4, 80x24, inverse', 1, { ...M3, font: 'model4', columns: 80, rows: 24, wide: true, inverse: true }, '640x240', 'd4af48cfd9a63f0631d6ccde89fbd24879f4e9977d813c60fb9fa4fd13d0d94a'],
  ['Model 4, 40x24, inverse, the alternate set', 2, { ...M3, font: 'model4', columns: 40, rows: 24, wide: true, inverse: true, altCharset: true }, '640x240', 'bc0fb9252e7037ee7dda06b192e6cbbdd26c24949d299017d43ef4fea961f6b3'],
];

describe('renderScreen draws the pixels the web app drew before the move', () => {
  it.each(PINS)('%s', (_name, step, view, size, hash) => {
    const { out, size: got } = draw(everyByte(step), view);
    expect(got).toBe(size);
    expect(sha(out)).toBe(hash);
  });

  it('renderNotice too, on the Model III and the Model I', () => {
    const lines = ['No ROM for the Model III', '', 'abc ~ é {}'];
    for (const [view, hash] of [
      [M3, '5abb6b55d6783e6a4188d7c912aaca562f98225424c152dc9613093874682188'],
      [{ ...M3, font: 'model1' }, '5c2c5ecd8aa9cde9475b6ddda1f3d914dcda546c578409220434a19786c4e679'],
    ]) {
      const { width, height } = screenSize(view);
      const out = new Uint8ClampedArray(width * height * 4);
      renderNotice(lines, view, out, width);
      expect(sha(out)).toBe(hash);
    }
  });

  it('holds the same glyph tables', () => {
    expect([CG_MODEL1, CG_MODEL1_LOWERCASE, CG_MODEL3, CG_MODEL4].map((s) => [s.width, s.height, sha(s.rows)])).toEqual([
      [6, 12, '0867311b071970aa153746654680bd064ffdc687d8aac6ce5aca8d1ab04991d9'],
      [6, 12, '8f5a1ef815d29e1223c6c1d2ad4b401a1c1b3ced23147fc8a8b7940e8c86487a'],
      [8, 12, '68458eff5544f362475035490169c712097380da24d76bee6ab7903eb70b96e7'],
      [8, 12, '84c55d99c73c8265e7bf820a23809f0d7c5ac695267511e627f48c45d9764bdc'],
    ]);
  });

  it('keeps the colours, the shapes and the fits', () => {
    expect(SCREEN_FG).toEqual([0xf2, 0xf2, 0xf2, 0xff]);
    expect(SCREEN_BG).toEqual([0, 0, 0, 0xff]);
    expect(MODEL3_ASPECT).toBe(4 / 3);
    expect(MODEL1_ASPECT).toBeCloseTo(0.952, 3);
    expect(tubeAspect('model1-lowercase')).toBe(MODEL1_ASPECT);
    expect(tubeAspect('model4')).toBe(MODEL3_ASPECT);
    expect(tubeFit(192, MODEL3_ASPECT, 1000, 600)).toEqual({ width: 768, height: 576 });
    expect(panelFit(192, 384, MODEL1_ASPECT, 1000)).toEqual(tubeFit(192, MODEL1_ASPECT, 1000, 576));
  });
});

/** The ROM size each model takes (emu's models.js), blank: nothing here runs the ROM. */
const ROM_BYTES = { 1: 0x3000, 3: 0x3800 };

/** What the web app's screenView(m) returns for an emulator `m` (apps/web/app/utils/emulator/screen.ts). */
const emuView = (m) => ({
  columns: m.video.columns,
  rows: m.video.rows,
  wide: m.video.wide,
  inverse: m.video.inverse,
  font: m.model === 1 ? (m.system.lowercase ? 'model1-lowercase' : 'model1') : m.model === 4 ? 'model4' : 'model3',
  altCharset: m.video.altCharset,
});

describe("screenOf(z): a port's screen, as screenView(m) gives an emulator's", () => {
  for (const model of /** @type {const} */ ([3, 1])) {
    it(`the Model ${model === 3 ? 'III' : 'I'}: the same view and the same pixels after the same writes`, () => {
      const z = createZ({ model });
      const m = new Machine({ model, roms: { level2: new Uint8Array(ROM_BYTES[model]) } });
      const check = () => {
        expect(screenOf(z)).toEqual(emuView(m));
        const raw = z.mem.subarray(0x3c00, 0x4000);
        expect([...raw]).toEqual([...m.video.raw]);
        expect(sha(draw(raw, screenOf(z)).out)).toBe(sha(draw(m.video.raw, emuView(m)).out));
      };
      check();
      for (let a = 0; a < 0x400; a++) {
        z.write(0x3c00 + a, a & 0xff);
        m.mem.write(0x3c00 + a, [a & 0xff]);
      }
      check();
      // The modes: the 32-column bit, and on the Model III the alternate set (port $EC bit 3).
      const modes = model === 3 ? [[0xec, 0x04], [0xec, 0x08], [0xec, 0x0c], [0xec, 0x30], [0xec, 0x00]] : [[0xff, 0x08], [0xff, 0x00], [0xff, 0xff]];
      for (const [port, v] of modes) {
        z.out(port, v);
        m.io.out(port, v);
        check();
      }
    });
  }

  it("refuses the flat machine, which has no screen", () => {
    expect(() => screenOf(createZ({ model: 'flat' }))).toThrow(/flat.*no screen/);
  });
});

it('links and loads in an empty vm context, as the runtime\'s other entries do (no-dom.test.js)', () => {
  const script = fileURLToPath(new URL('../../emu/scripts/check-no-dom.mjs', import.meta.url));
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', script, fileURLToPath(new URL('../src/screen.js', import.meta.url))], { encoding: 'utf8' });
  expect(r.stdout + r.stderr).toContain('no platform globals: ok');
  expect(r.status).toBe(0);
});
