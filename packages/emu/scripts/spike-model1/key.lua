-- Emu phase 7 (Model I) spike: MAME 0.289 trs80l2 autoboot script that answers MEM SIZE? with
-- ENTER through the natural keyboard at 2 emulated seconds and prints the top of the screen at
-- stop. No -debug needed.
local prog = manager.machine.devices[":maincpu"].spaces["program"]
local posted = false
FRAME_SUB = emu.add_machine_frame_notifier(function()
  if not posted and manager.machine.time.seconds >= 2 then
    manager.machine.natkeyboard:post("\n")
    posted = true
  end
end)
STOP_SUB = emu.add_machine_stop_notifier(function()
  for r = 0, 3 do
    local line = ""
    for c = 0, 63 do
      local b = prog:read_u8(0x3C00 + r * 64 + c) & 0x7F
      if b < 32 then b = b + 64 end
      line = line .. string.char(b)
    end
    print("|" .. line .. "|")
  end
end)
