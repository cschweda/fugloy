# Emu phase 7 (Model I) spike: compare two per-instruction records (fugloy-step.c line format)
# field by field; prints rows compared, rows differing, and per field the count and first row.
# usage: python3 -I fielddiff.py a.txt b.txt <rows>
import sys

names = ['i','pc','af','bc','de','hl','ix','iy','sp','iff1','t']
a, b, n = sys.argv[1], sys.argv[2], int(sys.argv[3])
first = {}; counts = {}; total = 0; rows = 0
with open(a) as fa, open(b) as fb:
    for la, lb in zip(fa, fb):
        if rows >= n: break
        rows += 1
        xa, xb = la.split(), lb.split()
        bad = False
        for k in range(1, 11):
            if xa[k] != xb[k]:
                counts[names[k]] = counts.get(names[k], 0) + 1
                first.setdefault(names[k], (xa[0], xa[k], xb[k]))
                bad = True
        total += bad
print(f'rows {rows}, rows differing {total}')
for k in names[1:]:
    if k in counts: print(f'  {k}: {counts[k]} rows; first at {first[k][0]}: {first[k][1]} vs {first[k][2]}')
