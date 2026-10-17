<script setup lang="ts">
import MachinePicker from '~/components/MachinePicker.vue';

const route = useRoute();
const wb = useWorkbench();
const onWorkbench = computed(() => route.path === '/' && wb.session.value !== null);

// A file dropped anywhere must never make the browser open it and leave the
// app. The workbench (pages/index.vue) opens what is dropped on it; elsewhere
// a drop does nothing.
const hasFiles = (e: DragEvent): boolean => e.dataTransfer?.types.includes('Files') ?? false;
function stopFileDrop(e: DragEvent): void {
  if (hasFiles(e)) e.preventDefault();
}
const persistence = usePersistence();
const flushNow = (): void => void persistence.flush();
onMounted(() => {
  void persistence.start();
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('dragover', stopFileDrop);
  document.addEventListener('drop', stopFileDrop);
});
onBeforeUnmount(() => {
  window.removeEventListener('pagehide', flushNow);
  document.removeEventListener('dragover', stopFileDrop);
  document.removeEventListener('drop', stopFileDrop);
});
</script>

<template>
  <div class="fg-shell flex flex-col" :class="onWorkbench ? 'h-screen' : 'min-h-screen'">
    <TopBar>
      <template #file>
        <template v-if="onWorkbench">
          <span class="fg-pill fg-mono" data-testid="file-name">{{ wb.session.value?.name }}</span>
          <button type="button" class="fg-link" data-testid="close-program" aria-label="Close the program and go back to the first screen" @click="wb.close()">Close</button>
        </template>
      </template>
      <template #pickers>
        <MachinePicker v-if="onWorkbench" />
      </template>
    </TopBar>
    <p class="fg-muted px-4 py-1 text-xs md:hidden">Fugløy is best on a desktop.</p>
    <main class="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <slot />
    </main>
  </div>
</template>
