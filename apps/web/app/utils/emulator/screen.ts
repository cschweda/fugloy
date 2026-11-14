// The TRS-80 screen of an emulator Machine. The renderer and the glyph tables are @fugloy/runtime's
// (packages/runtime/src/screen.js and glyphs.generated.js, from xtrs's trs_chars.c), one copy for
// the workbench and for a port's player (M2); this module re-exports them, so the site's importers
// are unchanged, and keeps the one part that reads an emulator: screenView(m). What the renderer
// draws, model by model, is described in the runtime's screen.js.
import type { Machine } from '@fugloy/emu';
import type { ScreenFont, ScreenView } from '@fugloy/runtime/screen';

export type { ScreenFont, ScreenView } from '@fugloy/runtime/screen';
export { SCREEN_FG, SCREEN_BG, screenSize, MODEL3_ASPECT, MODEL1_ASPECT, tubeAspect, tubeFit, panelFit, renderScreen, renderNotice } from '@fugloy/runtime/screen';

/** The view a machine's screen is in now. */
export function screenView(m: Machine): ScreenView {
  const v = m.video;
  const font: ScreenFont = m.model === 1 ? (m.system.lowercase ? 'model1-lowercase' : 'model1') : m.model === 4 ? 'model4' : 'model3';
  return { columns: v.columns, rows: v.rows, wide: v.wide, inverse: v.inverse, font, altCharset: v.altCharset };
}
