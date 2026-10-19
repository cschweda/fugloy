<script setup lang="ts">
// About: what Fugløy is, where your files go (nowhere), how storage and Back up / Restore work, ROMs and the stub ROM, the debug keys and the screen-text mirror, and credits.
import { SYMBOL_SOURCES } from '@fugloy/disasm';
import type { Source } from '@fugloy/disasm';
import { EXAMPLES } from '~/data/examples';

usePageSeo({
  title: 'About',
  description: 'Fugløy is a free TRS-80 Model I and III disassembler that runs in your browser. Your files never leave your machine. Credits for its symbol tables, zmac, and the public-domain games.',
  path: '/about',
});

const REPO = 'https://github.com/cschweda/fugloy';
const games = EXAMPLES[0]!;
const sources: readonly Source[] = SYMBOL_SOURCES;
const year = (s: Source): string => (s.circa === true ? `c. ${s.year}` : s.year);
const byline = (s: Source): string => (s.author === s.publisher ? s.author : `${s.author}, ${s.publisher}`);
// xtrs's LICENSE at the commit the screen's glyphs come from (scripts/build-glyphs.ts checks its SHA-256).
const XTRS_LICENSE = "Copyright (C) 1992 Clarendon Hill Software.\n\nPermission is granted to any individual or institution to use, copy,\nor redistribute this software, provided this copyright notice is retained. \n\nThis software is provided \"as is\" without any expressed or implied\nwarranty.  If this software brings on any sort of damage -- physical,\nmonetary, emotional, or brain -- too bad.  You've got no one to blame\nbut yourself. \n\nThe software may be modified for your own purposes, but modified versions\nmust retain this notice.\n\n***\n\nCopyright (c) 1996-2020, Timothy P. Mann\n\nPermission is hereby granted, free of charge, to any person\nobtaining a copy of this software and associated documentation\nfiles (the \"Software\"), to deal in the Software without\nrestriction, including without limitation the rights to use, copy,\nmodify, merge, publish, distribute, sublicense, and/or sell copies\nof the Software, and to permit persons to whom the Software is\nfurnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be\nincluded in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND\nNONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS\nBE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN\nACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN\nCONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE\nSOFTWARE.";
</script>

<template>
  <article class="fg-prose" data-testid="about">
    <h1 class="fg-strong text-2xl font-bold">About Fugløy</h1>
    <p class="fg-lede">
      Fugløy takes a TRS-80 Model I or Model III program apart into readable Z80 assembly, and can put it back together to the identical bytes.
      Open a <code>.CMD</code> load module, a tokenized <code>.BAS</code> program, or a raw binary, and read the listing, name what you find, and keep your notes.
    </p>
    <p>It is free, open source (MIT), and a personal project. The command-line tool and this workbench share one library, so they print the same listing.</p>

    <h2 id="privacy">Your files stay on your machine</h2>
    <p>
      Everything Fugløy does happens in this browser tab. A program you open is never uploaded: there is no server that accepts files, no account, and nothing is hosted.
      The only requests this site makes to anyone else are for the fonts on the technical details page, and, if you open the Manuals page, for cover images from archive.org.
    </p>

    <h2 id="storage">What is saved, and where</h2>
    <p>
      Your hints (the names, comments, and declarations you add), each program's machine and DOS settings, and the Z80 sources you write in <strong class="fg-strong">Source ✎</strong> are saved in this browser, in its own storage, as you work.
      Storage belongs to one browser on one computer: another browser, another profile, or a private window starts empty, and clearing the site's data erases it.
      Manuals you add stay there too, and so does a ROM you add in <strong class="fg-strong">Run ▶</strong>: it is stored in this browser only, never put in a backup, and never uploaded. Programs are never stored; you open them again each visit.
    </p>
    <p>
      To carry your work somewhere else, use <strong class="fg-strong">Your work</strong> in the top bar.
      <strong class="fg-strong">Back up</strong> downloads one JSON file with your hints, settings, and sources, and nothing else: no manuals, ROMs, or programs.
      <strong class="fg-strong">Restore…</strong> reads such a file on another browser or computer. It adds what is missing, and when a program already has different hints here, it asks before replacing them. A source is never replaced: one whose name is taken here is added under a new name.
      A program's hints can also be exported as a plain text hint file from the Export menu, a format made to be kept in git.
    </p>

    <h2 id="roms">ROMs, and the stub ROM</h2>
    <p data-testid="rom-statement">
      Fugløy ships no ROM. The TRS-80's ROMs are Tandy's, so their bytes are never bundled, fetched, committed, or put in a backup.
      To run a program that calls the ROM, add your own copy in <strong class="fg-strong">Run ▶</strong>, one per model: Fugløy recognises the Model I, III, and 4 ROMs by their SHA-256, and keeps any other file only at a size the model takes.
      Your ROM stays in this browser.
    </p>
    <p data-testid="stub-rom">
      A program that never calls the ROM runs without one, on Fugløy's <strong class="fg-strong">stub ROM</strong>: a few lines of Fugløy's own Z80 source (<code>stub-rom.z</code>), assembled in your browser when you press Run.
      It turns off interrupts, sets up a stack, blanks the screen, and halts, and the rest of the ROM's space is filled with HALT, so it holds no Tandy code.
      A program that calls or jumps into the ROM is stopped with a sentence naming its line, before it runs or the moment it gets there.
      One that only reads the ROM's bytes (through a pointer, say) is not stopped: on the stub it reads HALT instructions, not Tandy's code.
    </p>

    <h2 id="keys">Keys in Source ✎ and Run ▶</h2>
    <p>
      While a program runs, the line it is on is lit in <strong class="fg-strong">Source ✎</strong>, with a fading trail of the lines just before it, and in the listing when the listing shows the same program.
      Click the gutter beside a line to set a breakpoint there; breakpoints are saved with the source. These keys work once Source ✎ or Run ▶ has been opened:
    </p>
    <ul class="fg-credits" data-testid="debug-keys">
      <li><strong class="fg-strong">F5</strong>: run the source, or continue a paused program. Once Source ✎ or Run ▶ has been opened, F5 runs the source from anywhere in the workbench, the Listing included, so it no longer reloads the page.</li>
      <li><strong class="fg-strong">F6</strong>: pause. <strong class="fg-strong">Shift+F5</strong>: stop.</li>
      <li><strong class="fg-strong">F9</strong>: set or clear a breakpoint on the cursor's line, in the editor or in a listing of the running program.</li>
      <li><strong class="fg-strong">F10</strong>: step over (a CALL, an RST, or a repeating block instruction runs to its end). <strong class="fg-strong">F11</strong> or <strong class="fg-strong">F7</strong>: step one instruction (macOS keeps F11 for Show Desktop).</li>
      <li><strong class="fg-strong">Ctrl+F10</strong> or <strong class="fg-strong">⌘+F10</strong>: run to the cursor's line.</li>
      <li><strong class="fg-strong">Ctrl+Enter</strong> or <strong class="fg-strong">⌘+Enter</strong>: run, from anywhere in the workbench.</li>
    </ul>
    <p>
      The keys wait while you type in a text field. None of them reaches the TRS-80: other keys reach it only while its screen has focus.
      A screen reader hears each pause and step, and the registers beside the screen mark the values that changed.
    </p>
    <p data-testid="screen-text-about">
      Under the TRS-80's screen, <strong class="fg-strong">Screen text</strong> opens a list of the screen's rows as text, for a screen reader or for copying, with graphics read as spaces and an empty row read as "blank".
      It is closed until you open it, and <strong class="fg-strong">Speak screen changes</strong>, off until you turn it on, reads out the rows that change, at most once a second.
    </p>

    <h2 id="credits">Credits</h2>

    <h3 id="credit-games">The games</h3>
    <p>
      The four games that ship with Fugløy (Sea Dragon, Rear Guard, Eliminator, and Armored Patrol) were written by {{ games.authors }}.
      In 1995 Wayne Westmoreland released them into the public domain. His words, from
      <a :href="games.rightsUrl" rel="noopener noreferrer" target="_blank">trs-80.org</a>:
    </p>
    <blockquote class="fg-quote">“{{ games.rightsQuote }}”</blockquote>

    <h3 id="credit-symbols">The symbol tables</h3>
    <p>
      Every name Fugløy puts on a ROM, hardware, or DOS address comes from a table entry that cites one of these works and a page in it.
      Fugløy hosts none of them; the Manuals page opens your own copy at the cited page.
    </p>
    <ul class="fg-credits" data-testid="credit-sources">
      <li v-for="s in sources" :key="s.id">
        <cite>{{ s.title }}</cite>, {{ byline(s) }}, {{ year(s) }}<template v-if="s.edition">, {{ s.edition }}</template>.
        <a v-if="s.url" :href="s.url" rel="noopener noreferrer" target="_blank">Find a copy<span class="sr-only"> of {{ s.title }}</span></a>
      </li>
    </ul>

    <h3 id="credit-tools">Tools</h3>
    <ul class="fg-credits">
      <li>
        <a href="https://github.com/gp48k/zmac" rel="noopener noreferrer" target="_blank">zmac</a>, the Z80 macro cross-assembler, written by Bruce Norskog and maintained by George Phillips.
        Fugløy writes zmac source, and its tests reassemble every listing with zmac and compare the bytes.
        It is used in the tests only and is not part of this site.
      </li>
      <li>
        <a href="https://mozilla.github.io/pdf.js/" rel="noopener noreferrer" target="_blank">PDF.js</a> by Mozilla, which shows your manuals, under the Apache License 2.0.
        It is served from this site, with its <a href="/pdfjs/LICENSE">licence</a>.
      </li>
      <li data-testid="credit-font">
        <a href="https://www.jetbrains.com/lp/mono/" rel="noopener noreferrer" target="_blank">JetBrains Mono</a>, the typeface of the listing, by JetBrains, under the
        <a href="https://openfontlicense.org/" rel="noopener noreferrer" target="_blank">SIL Open Font License 1.1</a>.
        It is served from this site, from the <a href="https://fontsource.org/fonts/jetbrains-mono" rel="noopener noreferrer" target="_blank">Fontsource</a> package.
      </li>
      <li data-testid="credit-glyphs">
        The emulated TRS-80 screen's characters are the TRS-80's own character generators, from <code>trs_chars.c</code> in
        <a href="https://github.com/TimothyPMann/xtrs" rel="noopener noreferrer" target="_blank">xtrs</a>, Timothy P. Mann's TRS-80 emulator; its Model III sets were read from real character generator ROMs by Todd P. Cromwell III.
        Fugløy uses the Model I's (stock, and with the lowercase kit), the Model III's (with its katakana), and the Model 4's (with its international characters), converted once from a pinned copy whose SHA-256 it records.
        They are under xtrs's licence, Copyright (C) 1992 Clarendon Hill Software and Copyright (c) 1996-2020, Timothy P. Mann:
        <details class="mt-1">
          <summary>xtrs's licence</summary>
          <pre class="mt-1 text-xs whitespace-pre-wrap" data-testid="xtrs-license">{{ XTRS_LICENSE }}</pre>
        </details>
      </li>
      <li data-testid="credit-codemirror">
        <a href="https://codemirror.net/" rel="noopener noreferrer" target="_blank">CodeMirror 6</a> by Marijn Haverbeke and others, the editor in <strong class="fg-strong">Source ✎</strong>, under the MIT License.
        It is served from this site, loaded only when you first open Source ✎.
      </li>
    </ul>

    <h2 id="source">Source</h2>
    <p>
      The code, the plan, and the test suite are at <a :href="REPO" rel="noopener noreferrer" target="_blank">github.com/cschweda/fugloy</a>.
      <NuxtLink to="/technical-details">Technical details</NuxtLink> explains how it works.
    </p>
  </article>
</template>
