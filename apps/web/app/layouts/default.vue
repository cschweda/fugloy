<template>
  <div class="flex min-h-screen flex-col" style="background: var(--fg-bg); color: var(--fg-text)">
    <TopBar />
    <p class="px-4 py-1 text-xs md:hidden" style="color: var(--fg-muted)">
      Fugløy is best on a desktop.
    </p>
    <main class="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <slot />
    </main>
  </div>
</template>
