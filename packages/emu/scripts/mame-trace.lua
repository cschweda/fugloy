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
-- $FUGLOY_MAME_MATRIX, if set, names a file of lines `<emulated seconds> <row> <bit> <0|1>`, each a
-- key of the matrix (row 0-7 is MAME's :LINE0-:LINE7, bit 0-7 its field of mask 1 << bit) pressed
-- (1) or released (0) at the first frame at or after its time, so a key can be held.
--
-- A program: $FUGLOY_MAME_LOAD, if set, names a file whose first line is `<total cycles> <entry>`
-- and whose other lines are `<address> <file>`, each a run of the program's bytes. At the first
-- instruction boundary at or after that many cycles (a register point, made first so it is point
-- 1), it writes `L <PC>` (the PC the instruction would have run at), loads each run into memory
-- with the debugger's `load` (no watchpoint sees it), writes `M`, sets the PC to the entry, the
-- counter temp0 to 1 and temp1 (which holds the count back until then) to 1, so the instruction
-- that runs is the program's first and the run goes on for $FUGLOY_MAME_RECORDS records after the
-- load: the T line before `L` is the state before that instruction, with the PC it replaced.
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

local matrixFile = os.getenv("FUGLOY_MAME_MATRIX")
local matrix = {}
if matrixFile ~= nil and matrixFile ~= "" then
  for line in io.lines(matrixFile) do
    local at, row, bit, down = line:match("^(%S+) (%d) (%d) ([01])$")
    if at ~= nil then
      local port = assert(manager.machine.ioport.ports[":LINE" .. row], "no keyboard row :LINE" .. row)
      local field = nil
      for _, f in pairs(port.fields) do
        if f.mask == (1 << tonumber(bit)) then field = f end
      end
      matrix[#matrix + 1] = { at = tonumber(at), field = assert(field, "no key at :LINE" .. row .. " bit " .. bit), down = down == "1" }
    end
  end
end
local nextMatrix = 1
FUGLOY_MATRIX_SUB = emu.add_machine_frame_notifier(function()
  local now = manager.machine.time:as_double()
  while nextMatrix <= #matrix and matrix[nextMatrix].at <= now do
    local e = matrix[nextMatrix]
    if e.down then e.field:set_value(1) else e.field:clear_value() end
    nextMatrix = nextMatrix + 1
  end
end)

local dbg = manager.machine.debugger
dbg:command('save ' .. startMem .. ',0,10000')
dbg:command('temp0 = 0')
-- temp1: 1 once the run counts toward its records (at once, or from the load).
dbg:command('temp1 = 1')
local loadFile = os.getenv("FUGLOY_MAME_LOAD")
if loadFile ~= nil and loadFile ~= "" then
  local at, entry
  local runs = {}
  for line in io.lines(loadFile) do
    if at == nil then
      at, entry = line:match("^(%d+) (%x+)$")
      assert(at ~= nil, "the load file's first line is not <cycles> <entry>")
    else
      local addr, file = line:match("^(%x+) (%S+)$")
      runs[#runs + 1] = 'load ' .. file .. ',' .. addr
    end
  end
  dbg:command('temp1 = 0')
  dbg:command('rpset totalcycles >= #' .. at .. ',{tracelog "L %04X\\n",pc; ' .. table.concat(runs, '; ') .. '; tracelog "M\\n"; pc = ' .. entry .. '; temp0 = 1; temp1 = 1; rpclear 1; g}')
end
dbg:command('trace ' .. trace .. ',maincpu,noloop,{tracelog "T %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %04X %02X %02X %d %d %d %d %02X\\n",pc,af,bc,de,hl,af2,bc2,de2,hl2,ix,iy,sp,i,r,iff1,iff2,im,totalcycles,b@pc; temp0 = temp0 + 1}')
dbg:command('wpset 0,10000,w,1,{tracelog "W %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('wpset 3800,400,r,1,{tracelog "R %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('wpset 37e0,4,r,1,{tracelog "R %04X %02X\\n",wpaddr,wpdata; g}')
dbg:command('rpset temp1 == 1 && temp0 >= #' .. string.format("%d", records) .. ',{tracelog "E\\n"; save ' .. endMem .. ',0,10000; exit}')
dbg:command('go')
