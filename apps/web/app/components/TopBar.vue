<template>
  <header class="fg-bar flex flex-wrap items-center gap-3 px-3 py-2 text-xs">
    <NuxtLink to="/" class="fg-wordmark fg-strong rounded-sm font-bold" aria-label="Fugløy home">
      fugl<span class="fg-accent">ø</span>y
    </NuxtLink>
    <div class="flex items-center gap-2"><slot name="file" /></div>
    <div class="flex items-center gap-2"><slot name="pickers" /></div>
    <span class="flex-1" />
    <div class="flex items-center gap-2"><slot name="export" /></div>
    <nav class="flex items-center gap-3" aria-label="Site">
      <NuxtLink to="/technical-details" class="fg-link">Technical details</NuxtLink>
      <NuxtLink to="/manuals" class="fg-link">Manuals</NuxtLink>
      <NuxtLink to="/about" class="fg-link">About</NuxtLink>
    </nav>
  </header>
</template>
