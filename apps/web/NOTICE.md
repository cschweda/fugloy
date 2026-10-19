# Notice

`app/utils/emulator/glyphs.generated.ts`, the TRS-80 screen's glyphs in the Run tab, is converted
by `scripts/build-glyphs.ts` from `trs_chars.c` of [xtrs](https://github.com/TimothyPMann/xtrs),
Timothy P. Mann's TRS-80 emulator, at commit 3a2180c063811a715faa28d39a94739c33e0abd0
(SHA-256 `1b8bbb9d63a8d598e58f64e831fc11a08f61a82e5c2eb0f631e5cc7be1464166`). That file holds the
TRS-80 character generators; the Model III sets were read from real character generator ROMs by
Todd P. Cromwell III. Fugløy keeps four of them: CG 1 (the Model I's stock generator), CG 2 (the
Model I's lowercase kit), CG 4 (the Model III's, katakana alternates), and CG 8 (the Model 4's,
international alternates), with each pixel row's bits reversed so the leftmost pixel is in bit 7.
`trs_chars.c` is not committed. It is under xtrs's licence, its `LICENSE` file at the same commit:

```text
Copyright (C) 1992 Clarendon Hill Software.

Permission is granted to any individual or institution to use, copy,
or redistribute this software, provided this copyright notice is retained. 

This software is provided "as is" without any expressed or implied
warranty.  If this software brings on any sort of damage -- physical,
monetary, emotional, or brain -- too bad.  You've got no one to blame
but yourself. 

The software may be modified for your own purposes, but modified versions
must retain this notice.

***

Copyright (c) 1996-2020, Timothy P. Mann

Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation
files (the "Software"), to deal in the Software without
restriction, including without limitation the rights to use, copy,
modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS
BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
