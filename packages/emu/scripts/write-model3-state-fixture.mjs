/**
 * Writes fixtures/synthetic/emu/model3-state.json, the state at the end of the synthetic Model III
 * session in test/unit/model3-state-sample.js. Run by `pnpm fixtures`; the test `the Model III is
 * unchanged` (test/unit/model1.test.js) fails when the committed file differs from what the code
 * produces. Rewrite it only for an intended change to the Model III.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { model3SampleText } from '../test/unit/model3-state-sample.js';

const dir = fileURLToPath(new URL('../../../fixtures/synthetic/emu/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}model3-state.json`, model3SampleText());
console.log(`wrote the Model III state fixture to ${dir}model3-state.json`);
