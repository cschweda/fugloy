// Scopes a stylesheet to one element, so a page fragment that ships its own CSS (the
// Inside Fugløy explainer) cannot restyle the rest of the site. Every selector gets the
// scope as a prefix; :root, html and body stand for the scope element itself. Rules inside
// @media / @supports / @container / @layer are scoped; @keyframes, @font-face and other
// at-rules are copied as they are.

const WHOLE_PAGE = /^(?::root|html|body)(?![\w-])/;
const NESTING = /^@(?:media|supports|container|layer|document)\b/;

/** Index just past the `}` that closes the block opened at `open`, skipping strings and comments. */
function blockEnd(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (c === '"' || c === "'") i = stringEnd(css, i);
    else if (c === '/' && css[i + 1] === '*') i = css.indexOf('*/', i + 2) + 1 || css.length;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i + 1;
  }
  return css.length;
}

/** Index of the closing quote of the string that starts at `start`. */
function stringEnd(css: string, start: number): number {
  const q = css[start];
  for (let i = start + 1; i < css.length; i++) {
    if (css[i] === '\\') i++;
    else if (css[i] === q) return i;
  }
  return css.length;
}

/** Splits a selector list at its top-level commas (not those inside parentheses, brackets or strings). */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (c === '"' || c === "'") i = stringEnd(list, i);
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(list.slice(from, i));
      from = i + 1;
    }
  }
  parts.push(list.slice(from));
  return parts;
}

function scopeSelector(selector: string, scope: string): string {
  const lead = /^\s*/.exec(selector)![0];
  const trail = /\s*$/.exec(selector)![0];
  const sel = selector.trim();
  return lead + (WHOLE_PAGE.test(sel) ? sel.replace(WHOLE_PAGE, scope) : `${scope} ${sel}`) + trail;
}

export function scopeCss(css: string, scope: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    // Comments and whitespace between rules pass through.
    const skip = /^(?:\s+|\/\*[\s\S]*?\*\/)/.exec(css.slice(i));
    if (skip) {
      out += skip[0];
      i += skip[0].length;
      continue;
    }
    // The prelude runs to the next `{` (a rule) or `;` (a statement such as @import).
    let j = i;
    while (j < css.length && css[j] !== '{' && css[j] !== ';') {
      if (css[j] === '"' || css[j] === "'") j = stringEnd(css, j);
      else if (css[j] === '/' && css[j + 1] === '*') j = css.indexOf('*/', j + 2) + 1 || css.length;
      j++;
    }
    if (css[j] === ';' || j >= css.length) {
      out += css.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    const prelude = css.slice(i, j);
    const end = blockEnd(css, j);
    const body = css.slice(j + 1, end - 1);
    if (prelude.trimStart().startsWith('@')) {
      out += NESTING.test(prelude.trimStart()) ? `${prelude}{${scopeCss(body, scope)}}` : `${prelude}{${body}}`;
    } else {
      out += `${splitList(prelude).map((s) => scopeSelector(s, scope)).join(',')}{${body}}`;
    }
    i = end;
  }
  return out;
}
