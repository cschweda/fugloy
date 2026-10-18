/**
 * Writes fixtures/synthetic/label-file/sample.labels.json, the label file of the synthetic session
 * in test/unit/label-sample.js. Run by `pnpm fixtures`; test/unit/label-file.test.js fails when the
 * committed file differs from what this writes.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sampleLabelText } from '../test/unit/label-sample.js';

const dir = fileURLToPath(new URL('../../../fixtures/synthetic/label-file/', import.meta.url));
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}sample.labels.json`, sampleLabelText());
console.log(`wrote the label file fixture to ${dir}sample.labels.json`);
