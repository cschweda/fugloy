// Emu phase 7 (Model I) spike: step our Model I and print one line per instruction, in the same
// format as `fugloy-xtrs <rom> --trace <n>` (packages/emu/scripts/xtrs/fugloy-xtrs.c; index PC AF BC DE HL IX IY SP IFF1 cycles, the state before each).
// usage: node ours.mjs <rom> <instructions> <out> [mame]
//   mame: start from MAME 0.289's reset registers and power-on video RAM (AF 0040, SP 0000,
//   IX/IY FFFF, video RAM 00), as its trace shows.
import { readFileSync, writeFileSync } from 'node:fs';
import { Machine } from '../../src/index.js';

const [rom, nStr, out, sync] = process.argv.slice(2);
if (!rom || !nStr || !out) {
  console.error('usage: node ours.mjs <rom> <instructions> <out> [mame]');
  process.exit(2);
}
const n = Number(nStr);
const m = new Machine({ model: 1, roms: { level2: new Uint8Array(readFileSync(rom)) } });
if (sync === 'mame') {
  const r = m.system.cpu.registers;
  r.A = 0x00; r.F = 0x40; r.SP = 0x0000;
  m.system.cpu.IX = 0xffff; m.system.cpu.IY = 0xffff;
  m.system.memory.videoRam.fill(0);
}
const h4 = (v) => v.toString(16).toUpperCase().padStart(4, '0');
const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const lines = [];
const t0 = performance.now();
for (let i = 0; i < n; i++) {
  const r = m.cpu.regs;
  lines.push(`${i} ${h4(r.pc)} ${h2(r.a)}${h2(r.f)} ${h2(r.b)}${h2(r.c)} ${h2(r.d)}${h2(r.e)} ${h2(r.h)}${h2(r.l)} ${h4(r.ix)} ${h4(r.iy)} ${h4(r.sp)} ${r.iff1 ? 1 : 0} ${m.cycles}`);
  m.step();
}
const s = (performance.now() - t0) / 1000;
writeFileSync(out, lines.join('\n') + '\n');
console.error(`instructions ${n} seconds ${s.toFixed(3)} ips ${Math.round(n / s)} tstates ${m.cycles}`);
console.error(m.video.text().join('\n'));
