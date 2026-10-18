/** The register block (docs/fugloy-mcp-spec.md §4) and its JSON form. */
import { h2, h4 } from './hex.js';

const pair = (/** @type {number} */ hi, /** @type {number} */ lo) => ((hi & 0xff) << 8) | (lo & 0xff);

/**
 * @param {any} regs `m.cpu.regs`
 * @param {{ s: boolean, z: boolean, h: boolean, pv: boolean, n: boolean, c: boolean }} flags `m.cpu.flags` (booleans; shown as 1 or 0)
 * @param {number} cycles
 * @returns {string}
 */
export function regsBlock(regs, flags, cycles) {
  const r = regs;
  return [
    `PC ${h4(r.pc)}  SP ${h4(r.sp)}  AF ${h4(pair(r.a, r.f))}  BC ${h4(pair(r.b, r.c))}  DE ${h4(pair(r.d, r.e))}  HL ${h4(pair(r.h, r.l))}  IX ${h4(r.ix)}  IY ${h4(r.iy)}`,
    `AF' ${h4(pair(r.a2, r.f2))} BC' ${h4(pair(r.b2, r.c2))} DE' ${h4(pair(r.d2, r.e2))} HL' ${h4(pair(r.h2, r.l2))}  I ${h2(r.i)}  R ${h2(r.r)}  IFF1 ${r.iff1 ? 1 : 0}  IFF2 ${r.iff2 ? 1 : 0}  IM ${r.im}`,
    `Flags: S${flags.s ? 1 : 0} Z${flags.z ? 1 : 0} H${flags.h ? 1 : 0} PV${flags.pv ? 1 : 0} N${flags.n ? 1 : 0} C${flags.c ? 1 : 0}     Cycles: ${cycles.toLocaleString('en-US')}`,
  ].join('\n');
}

/** The same facts as JSON text, every value a number, for an agent that wants to compute. */
export function regsJson(/** @type {any} */ regs, /** @type {any} */ flags, /** @type {number} */ cycles) {
  const r = regs;
  const bit = (/** @type {unknown} */ v) => (v ? 1 : 0);
  return JSON.stringify(
    {
      pc: r.pc, sp: r.sp,
      af: pair(r.a, r.f), bc: pair(r.b, r.c), de: pair(r.d, r.e), hl: pair(r.h, r.l), ix: r.ix, iy: r.iy,
      af2: pair(r.a2, r.f2), bc2: pair(r.b2, r.c2), de2: pair(r.d2, r.e2), hl2: pair(r.h2, r.l2),
      i: r.i, r: r.r, iff1: bit(r.iff1), iff2: bit(r.iff2), im: r.im,
      flags: { s: bit(flags.s), z: bit(flags.z), h: bit(flags.h), pv: bit(flags.pv), n: bit(flags.n), c: bit(flags.c) },
      cycles,
    },
    null,
    2,
  );
}
