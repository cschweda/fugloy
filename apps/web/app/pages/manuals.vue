<script setup lang="ts">
// Your manuals. Every source the symbol tables cite, with where a scan is known
// to exist and whether you have added your own copy. Manuals work like ROMs:
// most are still under copyright, so Fugløy hosts none of them. You provide a
// PDF, it stays in this browser (IndexedDB), and citations open it at the cited
// page. Covers come from archive.org's image service, said so on the page.
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Source } from '@fugloy/disasm';
import ConfirmDialog from '~/components/ConfirmDialog.vue';
import ManualThumb from '~/components/ManualThumb.vue';
import { useManuals } from '~/composables/useManuals';
import type { ManualEntry } from '~/composables/useManuals';
import { coverUrl } from '~/utils/manuals';
import { catalogLabel } from '~/utils/symbol-info';

useHead({
  title: 'Manuals · Fugløy',
  meta: [{ name: 'description', content: 'The TRS-80 manuals Fugløy cites. Add your own PDF copies; they stay in your browser and open at the cited page.' }],
});

const manuals = useManuals();
const backup = useBackup();
const route = useRoute();
/** Set once what is stored has been read: until then no cover is requested (it may be a manual you have). */
const ready = ref(false);
const message = ref<{ text: string; error: boolean } | null>(null);
const busy = ref(false);
/** A dropped PDF Fugløy did not recognize, waiting for "which manual is it?". */
const unknown = ref<File | null>(null);
const unknownPick = ref('');
const removing = ref<Source | null>(null);
const depth = ref(0);
const picker = ref<HTMLInputElement | null>(null);
const restorePicker = ref<HTMLInputElement | null>(null);
/** The source an "Add…" button is picking a file for. */
let pickFor: string | undefined;

const wanted = computed(() => (typeof route.query.add === 'string' ? route.query.add : null));

const year = (s: Source): string => (s.circa === true ? `c. ${s.year}` : s.year);
const byline = (s: Source): string => (s.author === s.publisher ? s.author : `${s.author} · ${s.publisher}`);

async function add(file: File, sourceId?: string): Promise<void> {
  busy.value = true;
  message.value = null;
  try {
    const r = await manuals.add(file, sourceId);
    if (r.ok) {
      unknown.value = null;
      const title = manuals.list.value.find((e) => e.source.id === r.sourceId)?.source.title ?? r.sourceId;
      message.value = { text: `Added ${file.name} as ${title}. It is stored in this browser only.`, error: false };
    } else if (sourceId === undefined && /which manual/i.test(r.reason)) {
      unknown.value = file;
      unknownPick.value = wanted.value ?? '';
    } else message.value = { text: r.reason, error: true };
  } finally {
    busy.value = false;
  }
}

function onDrop(e: DragEvent): void {
  depth.value = 0;
  const file = e.dataTransfer?.files[0];
  if (file === undefined) return;
  e.preventDefault();
  void add(file);
}

function pick(sourceId?: string): void {
  pickFor = sourceId;
  picker.value?.click();
}

function onPick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file !== undefined) void add(file, pickFor);
}

function onRestorePick(e: Event): void {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file !== undefined) void backup.restore(file);
}

async function confirmRemove(): Promise<void> {
  const s = removing.value;
  removing.value = null;
  if (s === null) return;
  try {
    await manuals.remove(s.id);
    message.value = { text: `Removed your copy of ${s.title} from this browser.`, error: false };
  } catch (err) {
    message.value = { text: err instanceof Error ? err.message : String(err), error: true };
  }
}

const offsets = ref<Record<string, string>>({});
async function saveOffset(id: string): Promise<void> {
  const n = Number(offsets.value[id]);
  if (!Number.isInteger(n) || n < 1) {
    message.value = { text: 'The PDF page of printed page 1 is a whole number, 1 or more.', error: true };
    return;
  }
  try {
    await manuals.setOffset(id, n);
    message.value = { text: `Saved: printed page 1 is PDF page ${n}, so numbered citations of this manual open by that offset.`, error: false };
  } catch (err) {
    message.value = { text: err instanceof Error ? err.message : String(err), error: true };
  }
}

const status = (e: ManualEntry): string => {
  if (!e.have) return 'Provide your own copy';
  const how = manuals.mapping(e.source.id);
  if (how === 'scan') return 'You have it: the archive.org scan';
  if (how === 'assumed') return 'You have it: page mapping assumed from the archive.org scan (set an offset below to override it)';
  if (how === 'offset') return 'You have it: numbered pages found by the offset you set';
  return 'You have it: set which PDF page is printed page 1';
};

onMounted(async () => {
  await manuals.refresh();
  ready.value = true;
  if (wanted.value !== null) {
    await nextTick();
    const card = document.getElementById(`manual-${wanted.value}`);
    card?.scrollIntoView({ block: 'center' });
    card?.querySelector<HTMLElement>('[data-add]')?.focus();
  }
});
</script>

<template>
  <section class="fg-manuals" @dragenter="depth++" @dragleave="depth = Math.max(0, depth - 1)" @dragover.prevent @drop="onDrop">
    <header class="flex flex-col gap-2">
      <h1 class="fg-strong text-xl font-bold">Manuals</h1>
      <p class="max-w-3xl">
        These are the books Fugløy’s symbol tables cite, page by page. They are not part of Fugløy, and most are still under copyright, so Fugløy hosts none of them.
        <strong class="fg-strong">You provide your own copy</strong> as a PDF, the way you provide a ROM. It stays in this browser, is never uploaded, and is never
        put in a backup. Then a citation opens your copy at the cited page, with the name marked.
      </p>
      <p class="fg-muted max-w-3xl text-xs">
        Covers are fetched from archive.org’s image service (so you can be sure you are finding the right book); those requests carry nothing about your files.
      </p>
    </header>

    <div class="fg-dropzone fg-manuals-drop" :class="{ 'fg-dropzone-over': depth > 0 }" data-testid="manual-drop">
      <p class="fg-strong">Drop a manual’s PDF here</p>
      <p class="fg-muted text-xs">Fugløy recognizes the archive.org scans; for any other PDF it asks which manual it is.</p>
      <button type="button" class="fg-button" :disabled="busy" data-testid="manual-pick" @click="pick()">Choose a PDF…</button>
      <input ref="picker" type="file" accept="application/pdf,.pdf" class="sr-only" tabindex="-1" aria-label="Choose a manual PDF" data-testid="manual-file" @change="onPick" />
      <p v-if="busy" class="fg-muted" role="status">Reading the PDF…</p>
    </div>

    <form v-if="unknown" class="fg-manual-which" data-testid="manual-which" @submit.prevent="unknownPick && add(unknown, unknownPick)">
      <label for="manual-which" class="fg-strong">{{ unknown.name }} is not a scan Fugløy knows. Which manual is it?</label>
      <select id="manual-which" v-model="unknownPick" class="fg-input">
        <option value="" disabled>Choose a manual</option>
        <option v-for="e in manuals.list.value" :key="e.source.id" :value="e.source.id">{{ e.source.title }} ({{ year(e.source) }})</option>
      </select>
      <button type="submit" class="fg-button fg-button-primary" :disabled="!unknownPick || busy">Add</button>
      <button type="button" class="fg-button" @click="unknown = null">Cancel</button>
    </form>

    <p v-if="message" :class="message.error ? 'fg-error' : 'fg-muted'" role="status" data-testid="manual-message">{{ message.text }}</p>
    <p v-if="manuals.unavailable.value" class="fg-error" role="status">{{ manuals.unavailable.value }}</p>

    <ul class="fg-manual-list">
      <li
        v-for="e in manuals.list.value"
        :id="`manual-${e.source.id}`"
        :key="e.source.id"
        class="fg-manual"
        :class="{ 'fg-manual-wanted': wanted === e.source.id }"
        :data-testid="`manual-${e.source.id}`"
      >
        <ManualThumb v-if="ready && e.have" :source-id="e.source.id" :title="e.source.title" />
        <figure v-else-if="ready && e.source.archiveId" class="fg-cover">
          <img class="fg-cover-img" :src="coverUrl(e.source.archiveId)" :alt="`Cover of ${e.source.title}`" loading="lazy" referrerpolicy="no-referrer" width="112" height="145" />
          <figcaption class="fg-muted">cover image from archive.org</figcaption>
        </figure>
        <figure v-else class="fg-cover">
          <div class="fg-cover-card">{{ e.source.title }}</div>
          <figcaption class="fg-muted">{{ e.source.archiveId ? '' : 'no scan known' }}</figcaption>
        </figure>
        <div class="flex min-w-0 flex-col gap-1">
          <h2 class="fg-strong font-bold">{{ e.source.title }}</h2>
          <p>{{ byline(e.source) }}, {{ year(e.source) }}</p>
          <p v-if="e.source.edition || e.source.catalog" class="fg-muted">
            <template v-if="e.source.edition">{{ e.source.edition }} edition</template><template v-if="e.source.edition && e.source.catalog"> · </template><template v-if="e.source.catalog">{{ catalogLabel(e.source.catalog) }}</template>
          </p>
          <p :class="e.have ? 'fg-accent' : 'fg-muted'" data-testid="manual-status">{{ status(e) }}</p>
          <p v-if="e.source.url"><a :href="e.source.url" class="fg-inline-link" rel="noopener noreferrer" target="_blank">find a scan</a></p>
          <form v-if="e.have && manuals.mapping(e.source.id) !== 'scan'" class="fg-manual-offset" @submit.prevent="saveOffset(e.source.id)">
            <label :for="`offset-${e.source.id}`" class="fg-muted text-xs">PDF page of printed page 1</label>
            <input :id="`offset-${e.source.id}`" v-model="offsets[e.source.id]" class="fg-input fg-mono" inputmode="numeric" autocomplete="off" />
            <button type="submit" class="fg-button">Set</button>
          </form>
          <div class="flex flex-wrap gap-2">
            <button v-if="!e.have" type="button" class="fg-button" data-add :disabled="busy" @click="pick(e.source.id)">Add this manual…</button>
            <button v-else type="button" class="fg-button" @click="removing = e.source">Remove</button>
          </div>
        </div>
      </li>
    </ul>

    <section class="fg-manuals-backup" aria-labelledby="backup-title">
      <h2 id="backup-title" class="fg-strong font-bold">Your work</h2>
      <p class="fg-muted text-xs">Back up your hints and machine settings as one file, to carry to another computer. Backups never contain manuals, ROMs or programs: add your manuals once on each computer.</p>
      <div class="flex gap-2">
        <button type="button" class="fg-button" data-testid="manuals-backup" @click="backup.backUp()">Back up</button>
        <button type="button" class="fg-button" data-testid="manuals-restore" @click="restorePicker?.click()">Restore…</button>
      </div>
      <input ref="restorePicker" type="file" accept=".json,application/json" class="sr-only" tabindex="-1" aria-label="Choose a backup file" @change="onRestorePick" />
    </section>

    <ConfirmDialog
      testid="manual-remove"
      :open="removing !== null"
      title="Remove this manual?"
      :message="`Remove your copy of ${removing?.title ?? ''} from this browser? You can add it again later.`"
      confirm-label="Remove"
      @confirm="confirmRemove"
      @cancel="removing = null"
    />
  </section>
</template>
