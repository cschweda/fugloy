<template>
  <header
    class="flex flex-wrap items-center gap-3 px-3 py-2 text-xs"
    style="background: var(--fg-surface); border-bottom: 1px solid var(--fg-border)"
  >
    <NuxtLink to="/" class="font-bold" style="color: var(--fg-text-strong)" aria-label="Fugløy home">
      fugl<span style="color: var(--fg-accent)">ø</span>y
    </NuxtLink>
    <div class="flex items-center gap-2"><slot name="file" /></div>
    <div class="flex items-center gap-2"><slot name="pickers" /></div>
    <span class="flex-1" />
    <div class="flex items-center gap-2"><slot name="export" /></div>
    <nav class="flex items-center gap-3" aria-label="Site">
      <NuxtLink to="/technical-details" class="hover:underline" style="color: var(--fg-muted)">Technical details</NuxtLink>
      <NuxtLink to="/manuals" class="hover:underline" style="color: var(--fg-muted)">Manuals</NuxtLink>
      <NuxtLink to="/about" class="hover:underline" style="color: var(--fg-muted)">About</NuxtLink>
    </nav>
  </header>
</template>
