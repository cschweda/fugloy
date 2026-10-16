import { expect, it } from 'vitest';
import { platformHits } from './platform-scan.js';

it('finds a global after a string that holds // or /*, which once hid the rest of the line', () => {
  expect(platformHits('const u = "http://x"; window.alert(1);')).toHaveLength(1);
  expect(platformHits("const g = '/*'; document.title = g; // */")).toHaveLength(1);
});

it('finds every platform name on the list, timers, encoders, and crypto included', () => {
  for (const line of ['global.foo = 1;', 'clearTimeout(t);', 'clearInterval(i);', 'setImmediate(f);', 'new TextEncoder();', 'new TextDecoder();', 'crypto.getRandomValues(a);', 'structuredClone(x);', 'new URL(s);', 'console.log(1);', 'Math.random();', 'Date.now();']) {
    expect(platformHits(line), line).toHaveLength(1);
  }
});

it('ignores names in comments, strings, template text, regular expressions, and property access', () => {
  for (const line of ['this.process(x); // window', '/* document */ let a = 1;', 'const s = "window";', 'const t = `the window ${a} opens`;', 'const r = /window/g;', 'x = a.console;']) {
    expect(platformHits(line), line).toEqual([]);
  }
});

it('still finds code inside a template expression and after a regular expression or a division', () => {
  expect(platformHits('const t = `${window.innerWidth}px`;')).toHaveLength(1);
  expect(platformHits('const r = /\\/\\//; navigator.x;')).toHaveLength(1);
  expect(platformHits('const q = a / b / c; fetch(q);')).toHaveLength(1);
});
