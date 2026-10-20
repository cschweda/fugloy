/*
 * Fugløy emu phase 7 (Model I) spike: a headless driver for xtrs's Model I core (no X, no SIGALRM).
 *
 * Our own code (the repository's MIT licence). It contains no xtrs source; it is compiled against
 * xtrs's headers and linked with xtrs's objects, built locally from the pinned commit in the
 * gitignored tools/xtrs/src (see build.sh). xtrs is Copyright (C) 1992 Clarendon Hill Software and
 * Copyright (c) 1996-2020 Timothy P. Mann; its LICENSE (kept in tools/xtrs/src) permits use,
 * modification and redistribution with those notices retained.
 *
 * Links xtrs's objects except main.o and trs_xinterface.o (this file holds the stubs they would
 * provide); z80.o is built with -Dmem_write=fg_mem_write -Dmem_write_word=fg_mem_write_word so
 * every CPU write is seen. The 40 Hz timer is driven from T-states: every TIMER_PERIOD T-states
 * the driver calls xtrs's own trs_timer_event (SIGALRM ignored, so its setitimer is inert).
 *
 * usage: fugloy-step <rom> <instructions> [phase] [flags: w = log writes, s = sync power-on to ours]
 *   prints one line per instruction (state BEFORE it runs), then the screen on stderr.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <time.h>
#include "z80.h"
#include "trs.h"
#include "trs_disk.h"
#include "trs_hard.h"
#include "trs_stringy.h"

/* --- what main.c / trs_xinterface.c would have provided --- */
int trs_model = 1;
int trs_paused = 1;
int trs_autodelay = 0;
char *program_name = "fugloy-step";
void trs_exit(void) { exit(0); }
void trs_get_event(int wait) { }
void trs_screen_80x24(int f) { } void trs_screen_alternate(int f) { }
void trs_screen_expanded(int f) { } void trs_screen_inverse(int f) { }
void trs_screen_scroll(void) { } void trs_screen_write_char(int p, int c) { }
void trs_get_mouse_max(int *x, int *y, unsigned int *s) { *x = *y = 0; *s = 0; }
void trs_get_mouse_pos(int *x, int *y, unsigned int *b) { *x = *y = 0; *b = 0; }
int trs_get_mouse_type(void) { return 0; }
void trs_set_mouse_max(int x, int y, unsigned int s) { } void trs_set_mouse_pos(int x, int y) { }
int grafyx_get_microlabs(void) { return 0; } int grafyx_m3_active() { return 0; }
unsigned char grafyx_m3_read_byte(int p) { return 0xff; } void grafyx_m3_reset() { }
int grafyx_m3_write_byte(int p, int v) { return 0; } void grafyx_m3_write_mode(int v) { }
int grafyx_read_data(void) { return 0xff; } void grafyx_set_microlabs(int o) { }
void grafyx_write_data(int v) { } void grafyx_write_mode(int v) { } void grafyx_write_overlay(int v) { }
void grafyx_write_x(int v) { } void grafyx_write_xoffset(int v) { } void grafyx_write_y(int v) { }
void grafyx_write_yoffset(int v) { }
void hrg_onoff(int e) { } int hrg_read_data(void) { return 0xff; }
void hrg_write_addr(int a, int m) { } void hrg_write_data(int d) { }

extern int trs_lowercase;
extern void trs_timer_event(int signo);
extern void mem_write(int address, int value);

static int log_writes = 0;
static int nwrites = 0;
static int waddr[16], wval[16];
void fg_mem_write(int address, int value) {
  if (nwrites < 16) { waddr[nwrites] = address & 0xffff; wval[nwrites] = value & 0xff; nwrites++; }
  mem_write(address, value);
}
void fg_mem_write_word(int address, int value) {
  fg_mem_write(address, value & 0xff);
  fg_mem_write((address + 1) & 0xffff, (value >> 8) & 0xff);
}

#define TIMER_PERIOD 44352ULL /* 1.77408 MHz / 40 Hz (CLOCK_MHZ_1, TIMER_HZ_1) */

int main(int argc, char **argv) {
  if (argc < 3) { fprintf(stderr, "usage: %s rom n [phase] [w]\n", argv[0]); return 2; }
  long n = atol(argv[2]);
  unsigned long long phase = argc > 3 ? strtoull(argv[3], 0, 0) : 0;
  const char *fl = argc > 4 ? argv[4] : "";
  log_writes = strchr(fl, 'w') != 0;
  int sync = strchr(fl, 's') != 0;
  signal(SIGALRM, SIG_IGN);
  trs_lowercase = 0;
  mem_init();
  trs_disk_init();
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror(argv[1]); return 1; }
  int c, a = 0;
  while ((c = fgetc(f)) != EOF) mem_write_rom(a++, c);
  fclose(f);
  trs_rom_size = a;
  trs_reset(1);
  if (sync) { /* match our Model I's power-on: AF 0000, video RAM spaces */
    REG_A = 0; REG_F = 0;
    for (int v = 0x3C00; v < 0x4000; v++) mem_write(v, 0x20);
  }
  unsigned long long next_tick = TIMER_PERIOD - phase;
  struct timespec t0, t1; clock_gettime(CLOCK_MONOTONIC, &t0);
  for (long i = 0; i < n; i++) {
    printf("%ld %04X %02X%02X %04X %04X %04X %04X %04X %04X %d %llu",
           i, REG_PC, REG_A, REG_F, REG_BC, REG_DE, REG_HL, REG_IX, REG_IY, REG_SP,
           z80_state.iff1, (unsigned long long)z80_state.t_count);
    nwrites = 0;
    z80_run(0);
    if (log_writes) for (int k = 0; k < nwrites; k++) printf(" w%04X=%02X", waddr[k], wval[k]);
    putchar('\n');
    while (z80_state.t_count >= next_tick) { trs_timer_event(SIGALRM); next_tick += TIMER_PERIOD; }
  }
  clock_gettime(CLOCK_MONOTONIC, &t1);
  double s = (t1.tv_sec - t0.tv_sec) + (t1.tv_nsec - t0.tv_nsec) / 1e9;
  fprintf(stderr, "instructions %ld seconds %.3f ips %.0f tstates %llu\n", n, s, n / s,
          (unsigned long long)z80_state.t_count);
  fprintf(stderr, "screen:\n");
  for (int r = 0; r < 16; r++) {
    char line[65];
    for (int col = 0; col < 64; col++) {
      int b = mem_read(0x3C00 + r * 64 + col) & 0x7f;
      line[col] = (b >= 32 && b < 127) ? b : (b < 32 ? b + 64 : ' ');
    }
    line[64] = 0;
    fprintf(stderr, "|%s|\n", line);
  }
  return 0;
}
