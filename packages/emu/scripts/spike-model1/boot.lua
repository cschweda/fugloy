-- Emu phase 7 (Model I) spike: MAME 0.289 trs80l2 autoboot script. Prints the power-on RAM and
-- video RAM fill, starts a per-instruction debugger trace (state before each instruction:
-- PC AF BC DE HL IX IY SP IFF1 totalcycles, then MAME's disassembly line), logs CPU writes (W),
-- keyboard-matrix reads (K) and interrupt-latch reads (L) into the same file in order, and prints
-- the screen when the machine stops. Needs -debug -debugger none. The trace file is
-- $FUGLOY_MAME_TRACE (default ./trace.log); FUGLOY_MAME_WATCH=0 leaves out the W/K/L lines.
-- Notifier subscriptions are kept in globals: MAME unsubscribes one that is garbage-collected.
local cpu = manager.machine.devices[":maincpu"]
local prog = cpu.spaces["program"]
local trace = os.getenv("FUGLOY_MAME_TRACE") or "trace.log"
local watch = os.getenv("FUGLOY_MAME_WATCH") ~= "0"

local function hist(lo, hi)
  local h = {}
  for a = lo, hi do local b = prog:read_u8(a); h[b] = (h[b] or 0) + 1 end
  local s = ""
  for b, n in pairs(h) do s = s .. string.format(" %02X:%d", b, n) end
  return s
end
print("power-on RAM 4000-FFFF:" .. hist(0x4000, 0xFFFF))
print("power-on video 3C00-3FFF:" .. hist(0x3C00, 0x3FFF))

STOP_SUB = emu.add_machine_stop_notifier(function()
  for r = 0, 15 do
    local line = ""
    for c = 0, 63 do
      local b = prog:read_u8(0x3C00 + r * 64 + c) & 0x7F
      if b < 32 then b = b + 64 end
      line = line .. string.char(b)
    end
    print("|" .. line .. "|")
  end
end)

local dbg = manager.machine.debugger
dbg:command('trace ' .. trace .. ',maincpu,noloop,{tracelog "%04X %04X %04X %04X %04X %04X %04X %04X %d %d\\n",pc,af,bc,de,hl,ix,iy,sp,iff1,totalcycles}')
if watch then
  dbg:command('wpset 3c00,c400,w,1,{tracelog "  W %04X=%02X\\n",wpaddr,wpdata; g}')
  dbg:command('wpset 3800,400,r,1,{tracelog "  K %04X=%02X\\n",wpaddr,wpdata; g}')
  dbg:command('wpset 37e0,4,r,1,{tracelog "  L %04X=%02X\\n",wpaddr,wpdata; g}')
end
dbg:command('go')
