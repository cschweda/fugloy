/**
 * Writes examples/sea-dragon/seadrg01.labels.json, the label file of the scripted Sea Dragon
 * session in test/integration/sea-dragon-session.js. Needs the Model III ROM, named in
 * fugloy.mcp.json (see test/rom.js). test/integration/label-session.test.js fails when the
 * committed file differs from what this writes.
 *
 *   node packages/emu/scripts/sea-dragon-labels.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { configuredRom } from '../test/rom.js';
import { SEA_DRAGON_LABELS, seaDragonLabelText } from '../test/integration/sea-dragon-session.js';

const rom = configuredRom('model3');
if (rom === null) {
  console.error('no Model III ROM: name one as roms.model3 in fugloy.mcp.json (docs/fugloy-mcp-spec.md §3)');
  process.exit(1);
}
const path = fileURLToPath(SEA_DRAGON_LABELS);
writeFileSync(path, seaDragonLabelText(rom));
console.log(`wrote the Sea Dragon label file to ${path}`);
