<script setup lang="ts">
// About: what Fugløy is, where your files go (nowhere), how storage and Back up / Restore work, ROMs and the stub ROM, and credits.
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
      A program that calls a ROM routine, or reaches into the ROM's space, is stopped with a sentence naming its line, before it runs or the moment it gets there.
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
        The emulated TRS-80 screen's characters come from the X.Org
        <a href="https://gitlab.freedesktop.org/xorg/font/misc-misc" rel="noopener noreferrer" target="_blank">misc-misc</a> fonts (<code>6x12</code> and <code>6x10</code>), which are in the public domain.
        Their headers say: “Public domain terminal emulator font.  Share and enjoy.” Fugløy converts its pinned copy (font-misc-misc 1.1.3) once, recording each file's SHA-256.
        Nothing is copied from a TRS-80's character ROM, so the Model III's special and katakana characters are not drawn.
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
