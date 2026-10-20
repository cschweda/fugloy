-- MAME's Model I as a trace reference for emu phase 7's differential harness
-- (packages/emu/test/diff/mame-trace.js runs it; docs/superpowers/notes/2026-10-19-model1-references-spike.md,
-- "MAME trace format", says what each line means). MAME 0.289, driver trs80l2, run with
-- -debug -debugger none -autoboot_script <this file>.
--
-- Before the first instruction it saves the power-on memory ($0000-$FFFF) to $FUGLOY_MAME_START,
-- then starts the debugger's per-instruction trace into $FUGLOY_MAME_TRACE (a FIFO the recorder
-- reads), one `T` line per instruction with the state before it: PC AF BC DE HL AF' BC' DE' HL'
-- IX IY SP I R IFF1 IFF2 IM, the total cycles, and the instruction's first byte. Watchpoints add
-- `W addr value` for every CPU write and `R addr value` for every read of the keyboard matrix
-- ($3800-$3BFF) and the interrupt latch ($37E0-$37E3), in order, after the instruction's line.
-- MAME itself writes its disassembly after each T line and `(interrupted at XXXX, IRQ n)` before
-- a maskable interrupt response. When $FUGLOY_MAME_RECORDS T lines are written (a register point
-- on a counter, temp0; MAME's debugger reads numbers as hex, hence the `#`), it writes `E`, saves
-- the memory at that point to $FUGLOY_MAME_END, and exits MAME.
--
-- Keys: $FUGLOY_MAME_KEYS, if set, names a file of lines `<emulated seconds> <text as hex>`, each
-- posted through the natural keyboard at the first frame at or after its time. The keyboard
-- bytes the ROM read are in the trace (`R`), so the comparison follows them, not these times.
local trace = assert(os.getenv("FUGLOY_MAME_TRACE"), "FUGLOY_MAME_TRACE is not set")
local records = assert(tonumber(os.getenv("FUGLOY_MAME_RECORDS")), "FUGLOY_MAME_RECORDS is not set")
local startMem = assert(os.getenv("FUGLOY_MAME_START"), "FUGLOY_MAME_START is not set")
local endMem = assert(os.getenv("FUGLOY_MAME_END"), "FUGLOY_MAME_END is not set")
local keysFile = os.getenv("FUGLOY_MAME_KEYS")

local keys = {}
if keysFile ~= nil and keysFile ~= "" then
  for line in io.lines(keysFile) do
    local at, hex = line:match("^(%S+) (%x*)$")
    if at ~= nil then
      local text = hex:gsub("%x%x", function(h) return string.char(tonumber(h, 16)) end)
      keys[#keys + 1] = { at = tonumber(at), text = text }
    end
  end
end

-- Kept in a global: MAME unsubscribes a notifier that is garbage-collected.
local nextKey = 1
FUGLOY_FRAME_SUB = emu.add_machine_frame_notifier(function()
  local now = manager.machine.time:as_double()
  while nextKey <= #keys and keys[nextKey].at <= now do
    manager.machine.natkeyboard:post(keys[nextKey].text)
    nextKey = nextKey + 1
  end
end)

local dbg = manager.machine.debugger
dbg:command('save ' .. startMem .. ',0,10000')
dbg:command('temp0 = 0')
dbg:command('trace ' .. trace .. ',maincpu,noloop,{tracelog "T %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %02X %02X %d %d %d %d %02X\\n",pc,af,bc,de,hl,af2,bc2,de2,hl2,ix,iy,sp,i,r,iff1,iff2,im,totalcycles,b@pc; temp0 = temp0 + 1}')
dbg:command('wpset 0,10000,w,1,{tracelog "W %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('wpset 3800,400,r,1,{tracelog "R %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('wpset 37e0,4,r,1,{tracelog "R %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('rpset temp0 >= #' .. string.format("%d", records) .. ',{tracelog "E\\n"; save ' .. endMem .. ',0,10000; exit}')
dbg:command('go')
