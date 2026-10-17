<template>
  <div class="fg-shell flex min-h-screen flex-col">
    <TopBar />
    <p class="fg-muted px-4 py-1 text-xs md:hidden">Fugløy is best on a desktop.</p>
    <main class="flex min-h-0 flex-1 flex-col overflow-x-hidden">
      <slot />
    </main>
  </div>
</template>
