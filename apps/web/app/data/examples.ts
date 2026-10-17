// The four public-domain games bundled with the site, copied from each
// examples/<id>/README.md (test/examples.test.ts checks the files and the quote).
// prepare-examples serves examples/<id>/ at /examples/<id>/; nothing else is fetched.
import type { Machine } from '@fugloy/disasm';

export type ExampleId = 'sea-dragon' | 'rear-guard' | 'eliminator' | 'armored-patrol';

export interface Example {
  id: ExampleId;
  title: string;
  authors: string;
  publisher?: string;
  /** Absent where the README gives no year (Armored Patrol). */
  year?: number;
  /** The machine the picker opens it as. */
  machine: Machine;
  /** The build one click opens: the first the README presents. */
  mainBuild: string;
  /** Every bundled build, the main one first, then in the README's order. */
  builds: string[];
  /** A committed hint file for the main build. */
  hints?: string;
  rights: string;
  rightsQuote: string;
  rightsUrl: string;
}

const RIGHTS = 'public domain 1995';
const RIGHTS_QUOTE = 'I hereby release them into the public domain, do with them as you please';
const RIGHTS_URL = 'http://www.trs-80.org/games-by-wayne-westmoreland-and-terry-gilman.html';
const AUTHORS = 'Wayne Westmoreland and Terry Gilman';

export const EXAMPLES: readonly Example[] = [
  {
    id: 'sea-dragon',
    title: 'Sea Dragon',
    authors: AUTHORS,
    publisher: 'Adventure International',
    year: 1982,
    machine: 3,
    mainBuild: 'seadrg01.cmd',
    builds: ['seadrg01.cmd', 'seadrg02.cmd', 'seadrg03.cmd', 'seadrg04.cmd', 'seadrg06.cmd', 'seadrg07.cmd', 'seadrg08.cmd', 'seadrg09.cmd', 'seadrg10.cmd', 'seadrg11.cmd'],
    hints: 'seadrg01.hints',
    rights: RIGHTS,
    rightsQuote: RIGHTS_QUOTE,
    rightsUrl: RIGHTS_URL,
  },
  {
    id: 'rear-guard',
    title: 'Rear Guard',
    authors: AUTHORS,
    publisher: 'Adventure International',
    year: 1982,
    machine: 3,
    mainBuild: 'reargrd1.cmd',
    builds: ['reargrd1.cmd', 'reargrd3.cmd', 'reargrd7.cmd', 'reargrd2.cmd', 'reargrd4.cmd', 'reargrd5.cmd', 'reargrd6.cmd'],
    rights: RIGHTS,
    rightsQuote: RIGHTS_QUOTE,
    rightsUrl: RIGHTS_URL,
  },
  {
    id: 'eliminator',
    title: 'Eliminator',
    authors: AUTHORS,
    publisher: 'Adventure International',
    year: 1981,
    machine: 3,
    mainBuild: 'elimin8d.cmd',
    builds: ['elimin8d.cmd', 'elimin8f.cmd', 'elimin8g.cmd', 'elimin8h.cmd', 'elimin8c.cmd', 'elimin8e.cmd', 'elimin8a.cmd'],
    rights: RIGHTS,
    rightsQuote: RIGHTS_QUOTE,
    rightsUrl: RIGHTS_URL,
  },
  {
    id: 'armored-patrol',
    title: 'Armored Patrol',
    authors: AUTHORS,
    machine: 3,
    mainBuild: 'ARMOUR.III',
    builds: ['ARMOUR.III'],
    rights: RIGHTS,
    rightsQuote: RIGHTS_QUOTE,
    rightsUrl: RIGHTS_URL,
  },
];

export function isExampleId(id: string): id is ExampleId {
  return EXAMPLES.some((e) => e.id === id);
}

export function exampleById(id: ExampleId): Example {
  const e = EXAMPLES.find((x) => x.id === id);
  if (e === undefined) throw new Error(`no example ${id}`);
  return e;
}
