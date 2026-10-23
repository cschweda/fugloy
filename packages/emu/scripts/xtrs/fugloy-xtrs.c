/*
 * fugloy-xtrs: xtrs's Model I core as a headless stepping server, the lockstep reference of
 * Fugløy's emu phase 7 differential harness (packages/emu/test/diff/xtrs-adapter.js).
 *
 * Our own code (the repository's MIT licence). It contains no xtrs source; it is compiled against
 * xtrs's headers and linked with xtrs's objects, built by `pnpm xtrs:install`
 * (scripts/install-xtrs.sh) from the pinned commit in the gitignored tools/xtrs/src, with
 * xtrs-fugloy.patch applied. xtrs is Copyright (C) 1992 Clarendon Hill Software and Copyright (c)
 * 1996-2020 Timothy P. Mann; its LICENSE (kept in tools/xtrs/src, and quoted in
 * xtrs-fugloy.patch) permits use, modification and redistribution with those notices retained.
 *
 * It links xtrs's objects except main.o and trs_xinterface.o (this file holds the stubs they would
 * provide); z80.o is built with -Dmem_write=fg_mem_write -Dmem_write_word=fg_mem_write_word so
 * every CPU write is logged (a push in the Z80's byte order: push_like). Deterministic, as the spike note
 * (docs/superpowers/notes/2026-10-19-model1-references-spike.md) requires: no KBWAIT, no SIGALRM
 * timer (nothing arms it, and SIGALRM is ignored; the 40 Hz tick is made when the T-state count
 * reaches it, by the calls xtrs's own trs_timer_event makes: tick()), and the key queue is never
 * used (keys are set in the matrix).
 *
 * One step is one boundary as our Machine.step runs it: the timer tick if its T-state has come,
 * then the interrupt check (the patch's z80_fugloy_interrupt, which z80_run(0) would have made at
 * the end of the previous instruction), then one instruction with z80_run(-1) (two when xtrs ran
 * an ignored DD/FD prefix as its own: step()). So an interrupt response counts with the
 * instruction after it, and a DD/FD pair is one step, as ours does.
 *
 * usage: fugloy-xtrs <rom>              serve the line protocol below on stdin/stdout
 *        fugloy-xtrs <rom> --trace <n>  print n records in the spike's format and the screen
 *
 * Protocol: one command per line, one reply line each (hex without $; T-states in decimal).
 *   (start)                       -> ready fugloy-xtrs 1
 *   step [auto|hold|force]        -> S <cycles> <irq 0|1> <raised 0|1> <n> [<addr>=<val>]... R ...
 *   regs                          -> R <PC> <AF> <BC> <DE> <HL> <AF'> <BC'> <DE'> <HL'> <IX> <IY>
 *                                      <SP> <I> <R> <IFF1> <IFF2> <IM> <T>
 *   writes                        -> W <n> [<addr>=<val>]...   (the last step's)
 *   peek <addr> <len>             -> P <hex bytes>             (no side effects)
 *   poke <addr> <hex bytes>       -> ok                        ($3C00-$FFFF only; the rest ignored)
 *   setregs <PC> <AF> <BC> <DE> <HL> <AF'> <BC'> <DE'> <HL'> <IX> <IY> <SP> <I> <R> <IFF1> <IFF2>
 *           <IM> <EI> <T>         -> R ...    (EI 1: an EI just ran, so no interrupt at the next boundary)
 *   timer <T>                     -> ok       (the next 40 Hz tick's T-state)
 *   key <row> <bit> <0|1>         -> ok
 *   latch <byte>                  -> ok       (the $37E0 latch, and the INT line it drives)
 *   lowercase <0|1>               -> ok       (the lowercase modification: the bit-6 gate off)
 *   quit                          -> (exits)
 * A command it does not know gets `error <what>`.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include "z80.h"
#include "trs.h"
#include "trs_disk.h"
#include "trs_hard.h"
#include "trs_stringy.h"

/* --- what main.c / trs_xinterface.c would have provided --- */
int trs_model = 1;
int trs_paused = 1;
int trs_autodelay = 0;
char *program_name = "fugloy-xtrs";
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
extern int trs_rom_size;
extern Uchar memory[];
extern void mem_write(int address, int value);

/* --- exported by xtrs-fugloy.patch --- */
extern int z80_fugloy_interrupt(int last_instruction, int mode);
extern void trs_kb_fugloy_set(int row, int bit, int down);
extern int trs_kb_fugloy_peek(int address);
extern void trs_interrupt_latch_fugloy_set(int value);
extern int trs_interrupt_latch_fugloy_peek(void);

/* --- the write log --- */
#define MAX_WRITES 32
static int nwrites = 0, woverflow = 0;
static int waddr[MAX_WRITES], wval[MAX_WRITES];
static int in_response = 0; /* the interrupt check is running (an NMI or interrupt response) */
static int insn_pc = 0;     /* where the step's instruction began */
static int peek(int a);

static void log_write(int address, int value) {
  if (nwrites < MAX_WRITES) { waddr[nwrites] = address & 0xffff; wval[nwrites] = value & 0xff; nwrites++; }
  else woverflow = 1;
}
void fg_mem_write(int address, int value) {
  log_write(address, value);
  mem_write(address, value);
}
/*
 * Whether the word being written is a push: PUSH, CALL, RST, or an interrupt's response. The Z80
 * puts a push on the bus high byte first ("first decrements SP and loads the high-order byte ...
 * The SP is decremented again and loads the low-order byte": Zilog UM0080, PUSH qq), but xtrs
 * writes every 16-bit word low byte first (trs_memory.c, mem_write_word), so the order of its two
 * bytes is not something xtrs models. The log gives a push in the Z80's order; the writes
 * themselves are made as xtrs makes them. LD (nn),rr (low byte first on the Z80 too) and
 * EX (SP),rr keep xtrs's order.
 */
static int push_like(void) {
  if (in_response) return 1;
  int pc = insn_pc, op = peek(pc);
  /* past any DD/FD prefixes: DD E5 is PUSH IX, and a prefix xtrs ignores leaves a PUSH, CALL or RST */
  while (op == 0xDD || op == 0xFD) { pc = (pc + 1) & 0xffff; op = peek(pc); }
  return (op & 0xCF) == 0xC5 || op == 0xCD || (op & 0xC7) == 0xC4 || (op & 0xC7) == 0xC7;
}
void fg_mem_write_word(int address, int value) {
  int a1 = (address + 1) & 0xffff;
  if (push_like()) { log_write(a1, value >> 8); log_write(address, value); }
  else { log_write(address, value); log_write(a1, value >> 8); }
  /* as xtrs's own mem_write_word */
  mem_write(address, value & 0xff);
  mem_write(a1, (value >> 8) & 0xff);
}

#define TIMER_PERIOD 44352ULL /* 1.77408 MHz / 40 Hz (xtrs's CLOCK_MHZ_1, TIMER_HZ_1; our rtcInterval) */

static unsigned long long next_tick = TIMER_PERIOD;
static int last_op = 0; /* the first byte of the instruction the last step ran */

/* A byte as the CPU would read it, without a read's side effects. */
static int peek(int a) {
  a &= 0xffff;
  if (a >= 0x3c00) return memory[a];
  if (a < trs_rom_size) return memory[a];
  if ((a & ~3) == 0x37e0) return trs_interrupt_latch_fugloy_peek();
  if (a >= 0x3800) return trs_kb_fugloy_peek(a) & 0xff;
  return 0xff;
}

/*
 * One 40 Hz tick: the three calls xtrs's trs_timer_event (trs_interrupt.c) makes when its timer is
 * on, as it always is here (only the debugger's command turns it off). The rest of that function
 * is for a real-time timer: it reads the host's clock and re-arms SIGALRM by dividing by
 * timer_hz, which only trs_timer_init (called from main.c, not linked) and, for the Model 4,
 * trs_timer_speed set, so here it stays 0. Built for x86-64 the division traps (SIGFPE at the
 * first tick); on arm64 it returns 0; either way it is undefined behaviour, and the host's clock
 * has no place in a reference that must repeat byte for byte. Its x_poll_count = 0 only makes
 * z80_run call trs_get_event, a stub here, sooner.
 */
static void tick(void) {
  trs_timer_interrupt(1); /* generate */
  trs_disk_motoroff_interrupt(trs_disk_motoroff());
  trs_kb_heartbeat(); /* part of xtrs's keyboard stretch */
}

/* One boundary: the timer tick, the interrupt check, one instruction. Returns the T-states. */
static unsigned long long step(int mode, int *irq, int *raised) {
  unsigned long long t0 = z80_state.t_count;
  nwrites = 0; woverflow = 0;
  *raised = 0;
  while (z80_state.t_count >= next_tick) { tick(); next_tick += TIMER_PERIOD; *raised = 1; }
  in_response = 1;
  int taken = z80_fugloy_interrupt(last_op, mode);
  in_response = 0;
  *irq = taken == 1;
  insn_pc = REG_PC;
  last_op = peek(REG_PC);
  unsigned long long t1 = z80_state.t_count;
  z80_run(-1);
  /*
   * A DD or FD before an opcode xtrs has no indexed form for is ignored on its own: z80.c's
   * do_indexed_instruction, `default:`, backs PC up to the next byte and counts 4 T-states, so the
   * prefix ends a z80_run of its own (the only way a DD/FD run takes 4 T-states and leaves PC one
   * on). The Z80 runs the pair as one instruction (Young, "The Undocumented Z80 Documented",
   * §3.7), and so does our Machine.step, so the next instruction runs in the same step, with no
   * interrupt check between. Before DD, FD or ED the prefix is a lone one, its own step on both
   * sides (ours too), and the step ends there.
   */
  if ((last_op == 0xDD || last_op == 0xFD) && z80_state.t_count - t1 == 4 && REG_PC == ((insn_pc + 1) & 0xffff)) {
    int next = peek(REG_PC);
    if (next != 0xDD && next != 0xFD && next != 0xED) {
      insn_pc = REG_PC;
      last_op = next;
      z80_run(-1);
    }
  }
  return z80_state.t_count - t0;
}

static void print_regs(FILE *o) {
  fprintf(o, "R %04X %02X%02X %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %02X %02X %d %d %d %llu",
          REG_PC, REG_A, REG_F, REG_BC, REG_DE, REG_HL, REG_AF_PRIME, REG_BC_PRIME, REG_DE_PRIME,
          REG_HL_PRIME, REG_IX, REG_IY, REG_SP, REG_I, (REG_R7 & 0x80) | (REG_R & 0x7f),
          z80_state.iff1 ? 1 : 0, z80_state.iff2 ? 1 : 0, z80_state.interrupt_mode,
          (unsigned long long)z80_state.t_count);
}

static void print_writes(FILE *o) {
  fprintf(o, "%d", woverflow ? -1 : nwrites);
  for (int k = 0; k < nwrites; k++) fprintf(o, " %04X=%02X", waddr[k], wval[k]);
}

static int hexval(int c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static int serve(void) {
  char *line = 0;
  size_t cap = 0;
  ssize_t len;
  printf("ready fugloy-xtrs 1\n");
  fflush(stdout);
  while ((len = getline(&line, &cap, stdin)) > 0) {
    while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) line[--len] = 0;
    char *cmd = line, *rest = strchr(line, ' ');
    if (rest) *rest++ = 0; else rest = line + len;
    if (!strcmp(cmd, "step")) {
      int mode = !strcmp(rest, "hold") ? -1 : !strcmp(rest, "force") ? 1 : 0;
      int irq, raised;
      unsigned long long c = step(mode, &irq, &raised);
      printf("S %llu %d %d ", c, irq, raised);
      print_writes(stdout);
      putchar(' ');
      print_regs(stdout);
      putchar('\n');
    } else if (!strcmp(cmd, "regs")) {
      print_regs(stdout); putchar('\n');
    } else if (!strcmp(cmd, "writes")) {
      printf("W "); print_writes(stdout); putchar('\n');
    } else if (!strcmp(cmd, "peek")) {
      unsigned a, n;
      if (sscanf(rest, "%x %u", &a, &n) != 2) { printf("error peek\n"); fflush(stdout); continue; }
      putchar('P'); putchar(' ');
      for (unsigned k = 0; k < n; k++) printf("%02X", peek((int)(a + k)));
      putchar('\n');
    } else if (!strcmp(cmd, "poke")) {
      unsigned a;
      char *sp = strchr(rest, ' ');
      if (sscanf(rest, "%x", &a) != 1 || !sp) { printf("error poke\n"); fflush(stdout); continue; }
      for (char *h = sp + 1; h[0] && h[1]; h += 2, a++) {
        int hi = hexval(h[0]), lo = hexval(h[1]);
        if (hi < 0 || lo < 0) break;
        if ((a & 0xffff) >= 0x3c00) memory[a & 0xffff] = (Uchar)(hi << 4 | lo);
      }
      printf("ok\n");
    } else if (!strcmp(cmd, "setregs")) {
      unsigned pc, af, bc, de, hl, af2, bc2, de2, hl2, ix, iy, sp, i, r, iff1, iff2, im, ei;
      unsigned long long t;
      if (sscanf(rest, "%x %x %x %x %x %x %x %x %x %x %x %x %x %x %u %u %u %u %llu", &pc, &af, &bc, &de,
                 &hl, &af2, &bc2, &de2, &hl2, &ix, &iy, &sp, &i, &r, &iff1, &iff2, &im, &ei, &t) != 19) {
        printf("error setregs\n"); fflush(stdout); continue;
      }
      REG_PC = pc; REG_AF = af; REG_BC = bc; REG_DE = de; REG_HL = hl;
      REG_AF_PRIME = af2; REG_BC_PRIME = bc2; REG_DE_PRIME = de2; REG_HL_PRIME = hl2;
      REG_IX = ix; REG_IY = iy; REG_SP = sp; REG_I = i; REG_R = r & 0x7f; REG_R7 = r & 0x80;
      z80_state.iff1 = iff1 ? 1 : 0; z80_state.iff2 = iff2 ? 1 : 0; z80_state.interrupt_mode = im;
      z80_state.t_count = t;
      last_op = ei ? 0xFB : 0;
      print_regs(stdout); putchar('\n');
    } else if (!strcmp(cmd, "timer")) {
      next_tick = strtoull(rest, 0, 10);
      printf("ok\n");
    } else if (!strcmp(cmd, "key")) {
      int row, bit, down;
      if (sscanf(rest, "%d %d %d", &row, &bit, &down) != 3) { printf("error key\n"); fflush(stdout); continue; }
      trs_kb_fugloy_set(row, bit, down);
      printf("ok\n");
    } else if (!strcmp(cmd, "latch")) {
      trs_interrupt_latch_fugloy_set((int)strtoul(rest, 0, 16));
      printf("ok\n");
    } else if (!strcmp(cmd, "lowercase")) {
      trs_lowercase = atoi(rest) ? 1 : 0;
      printf("ok\n");
    } else if (!strcmp(cmd, "quit")) {
      return 0;
    } else {
      printf("error %s\n", cmd);
    }
    fflush(stdout);
  }
  return 0;
}

/* The spike's record (index PC AF BC DE HL IX IY SP IFF1 cycles, the state before each step). */
static int trace(long n) {
  for (long k = 0; k < n; k++) {
    printf("%ld %04X %02X%02X %04X %04X %04X %04X %04X %04X %d %llu\n",
           k, REG_PC, REG_A, REG_F, REG_BC, REG_DE, REG_HL, REG_IX, REG_IY, REG_SP,
           z80_state.iff1, (unsigned long long)z80_state.t_count);
    int irq, raised;
    step(0, &irq, &raised);
  }
  fprintf(stderr, "screen:\n");
  for (int r = 0; r < 16; r++) {
    char text[65];
    for (int col = 0; col < 64; col++) {
      int b = memory[0x3C00 + r * 64 + col] & 0x7f;
      text[col] = (b >= 32 && b < 127) ? b : (b < 32 ? b + 64 : ' ');
    }
    text[64] = 0;
    fprintf(stderr, "|%s|\n", text);
  }
  return 0;
}

int main(int argc, char **argv) {
  if (argc != 2 && !(argc == 4 && !strcmp(argv[2], "--trace"))) {
    fprintf(stderr, "usage: %s <rom> [--trace <n>]\n", argv[0]);
    return 2;
  }
  signal(SIGALRM, SIG_IGN);
  trs_lowercase = 0;
  mem_init();
  trs_disk_init();
  FILE *f = fopen(argv[1], "rb");
  if (!f) { perror(argv[1]); return 1; }
  int c, a = 0;
  while ((c = fgetc(f)) != EOF && a < 0x3800) mem_write_rom(a++, c);
  fclose(f);
  trs_rom_size = a;
  trs_reset(1);
  setvbuf(stdout, 0, _IOFBF, 1 << 20);
  return argc == 4 ? trace(atol(argv[3])) : serve();
}
