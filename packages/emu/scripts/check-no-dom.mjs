/**
 * Spec §2.1: load the core inside node:vm with an empty context object, so any reference to a
 * browser or Node global throws. Links src/index.js (or the module given) as ES modules in that
 * context, then builds a Model III with a synthetic ROM and runs it there. Run with
 * `node --experimental-vm-modules`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const entry = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.js'));
const context = vm.createContext({});
const modules = new Map();

function load(path) {
  let m = modules.get(path);
  if (m === undefined) {
    m = new vm.SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: path });
    modules.set(path, m);
  }
  return m;
}

function link(specifier, referencing) {
  if (!specifier.startsWith('.')) throw new Error(`${referencing.identifier} imports "${specifier}"; the core imports nothing from the platform`);
  return load(resolve(dirname(referencing.identifier), specifier));
}

try {
  const root = load(entry);
  await root.link(link);
  await root.evaluate();
  const { TRS80System, Machine, serializeState, restoreState } = root.namespace;
  if (typeof TRS80System === 'function') {
    // 0000 DI / LD SP,5000H / LD HL,3C00H / LD DE,0020H / LD B,5 / copy "READY" to the screen /
    // LD A,04H / OUT (0E0H),A / IM 1 / EI / JR $ ; 0038 IN A,(0ECH) / EI / RETI.
    const rom = new Uint8Array(0x3800);
    rom.set([0xf3, 0x31, 0x00, 0x50, 0x21, 0x00, 0x3c, 0x11, 0x20, 0x00, 0x06, 0x05, 0x1a, 0x77, 0x23, 0x13, 0x10, 0xfa, 0x3e, 0x04, 0xd3, 0xe0, 0xed, 0x56, 0xfb, 0x18, 0xfe], 0);
    rom.set([0x52, 0x45, 0x41, 0x44, 0x59], 0x20);
    rom.set([0xdb, 0xec, 0xfb, 0xed, 0x4d], 0x38);
    const sys = new TRS80System({ romData: rom });
    sys.runTStates(1_000_000);
    sys.keyboard.keyDown('a', 'check');
    sys.runTStates(70_000);
    sys.keyboard.keyUp('check');
    if (!sys.screenText()[0].startsWith('READY')) throw new Error(`the synthetic ROM did not reach the screen: ${JSON.stringify(sys.screenText()[0])}`);
    restoreState(sys, serializeState(sys));
    sys.runTStates(100_000);
    if (typeof Machine === 'function') {
      const m = new Machine({ roms: { level2: rom } });
      m.step(10);
      m.run({ cycles: 200_000, until: (mm) => mm.cpu.regs.pc === 0x19 });
      m.mem.write(0x4000, m.mem.read(0x3c00, 5));
      m.io.out(0xec, 0);
      if (m.rom.sha256.length !== 64 || m.cpu.flags === undefined) throw new Error('the Machine facade did not run');
    }
  }
  console.log('no platform globals: ok');
} catch (e) {
  console.error(e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  process.exit(1);
}
