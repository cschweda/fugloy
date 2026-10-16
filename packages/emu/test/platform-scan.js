/**
 * The platform scan behind platform-free.test.js: which lines of a JavaScript source name a
 * browser or Node global. A small lexer first removes comments and blanks the contents of
 * strings, template text, and regular-expression literals, so a `//` inside a string cannot
 * hide code and a word inside a literal never counts; template ${…} expressions stay code.
 */

export const GLOBALS = [
  'window', 'document', 'navigator', 'globalThis', 'self', 'global',
  'requestAnimationFrame', 'cancelAnimationFrame', 'AudioContext', 'webkitAudioContext',
  'localStorage', 'sessionStorage', 'fetch', 'XMLHttpRequest', 'addEventListener', 'removeEventListener',
  'atob', 'btoa', 'Buffer', 'process', 'require', 'console',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'performance', 'TextEncoder', 'TextDecoder', 'crypto', 'structuredClone', 'URL', 'Blob', 'Worker', 'postMessage',
];

/** A bare global (not a property like `this.process`, not part of a longer name), or a clock or random source. */
const PLATFORM = new RegExp(`(?<![.\\w$])(?:${GLOBALS.join('|')})(?![\\w$])|\\bDate\\.now\\b|\\bnew Date\\b|\\bMath\\.random\\b`);

const blank = (text) => text.replace(/[^\n]/g, ' ');
const REGEX_AFTER = '(,=:[!&|?{};+-*%<>~^';
const REGEX_AFTER_WORD = /(?:^|[^\w$])(?:return|typeof|case|do|else|in|of|new|delete|void|throw)$/;

/** The source with comments removed and literal contents blanked; newlines kept, so line numbers hold. */
export function codeOnly(src) {
  let out = '';
  let last = ''; // the last character of code, to tell a regular expression from a division
  let depth = 0; // brace depth in code
  const templates = []; // for each open ${…}, the depth at which its closing brace returns to template text
  let i = 0;
  const templateText = (from) => {
    // Template text from `from` to the closing backtick or the next ${; returns where it stopped.
    let j = from;
    while (j < src.length && src[j] !== '`' && !(src[j] === '$' && src[j + 1] === '{')) j += src[j] === '\\' ? 2 : 1;
    out += blank(src.slice(from, j));
    if (src[j] === '$') {
      out += '${';
      templates.push(depth);
      last = '{';
      return j + 2;
    }
    out += '`';
    last = '`';
    return j + 1;
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      const j = src.indexOf('\n', i);
      i = j < 0 ? src.length : j;
    } else if (c === '/' && d === '*') {
      const j = src.indexOf('*/', i + 2);
      const end = j < 0 ? src.length : j + 2;
      out += blank(src.slice(i, end));
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out += c + blank(src.slice(i + 1, j)) + c;
      last = c;
      i = j + 1;
    } else if (c === '`') {
      out += '`';
      i = templateText(i + 1);
    } else if (c === '}' && templates.length > 0 && templates[templates.length - 1] === depth) {
      templates.pop();
      out += '}';
      i = templateText(i + 1);
    } else if (c === '/' && (last === '' || REGEX_AFTER.includes(last) || REGEX_AFTER_WORD.test(out.trimEnd()))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n' && (inClass || src[j] !== '/')) {
        if (src[j] === '\\') j++;
        else if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        j++;
      }
      out += '/' + blank(src.slice(i + 1, j)) + '/';
      i = j + 1;
      while (i < src.length && /[a-z]/i.test(src[i])) out += src[i++];
      last = '/';
    } else {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      out += c;
      if (!/\s/.test(c)) last = c;
      i++;
    }
  }
  return out;
}

/** `line: code` for every line of `src` whose code names a platform global. */
export function platformHits(src) {
  return codeOnly(src)
    .split('\n')
    .flatMap((line, i) => (PLATFORM.test(line) ? [`${i + 1}: ${line.trim()}`] : []));
}
