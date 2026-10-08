# Paired per-case comparison of two replay_validate --cases files (same replays, two engine builds): per category, how
# many cases got better/worse and the median change.   python3 scripts/replay_paired.py BEFORE.csv AFTER.csv
import csv,sys,statistics as st
from collections import defaultdict
fb=open(sys.argv[1]); fp=open(sys.argv[2])
rb=csv.reader(fb); rp=csv.reader(fp)
h=next(rb); next(rp)
ic=h.index('category'); ip=h.index('car_pos'); ibp=h.index('ball_pos'); ir=h.index('replay'); iF=h.index('frame')
d=defaultdict(list); mism=0
for a,b in zip(rb,rp):
    if a[ir]!=b[ir] or a[iF]!=b[iF] or a[ic]!=b[ic]: mism+=1; continue
    col = ip if a[ip]!='' and b[ip]!='' else ibp
    if a[col]=='' or b[col]=='': continue
    d[a[ic]].append((float(a[col]),float(b[col])))
print('misaligned rows',mism)
tb=tw=0
for c in sorted(d):
    v=d[c]
    better=sum(1 for x,y in v if y<x-1e-4); worse=sum(1 for x,y in v if y>x+1e-4)
    tb+=better; tw+=worse
    if better+worse < 20: continue
    diffs=[y-x for x,y in v if abs(y-x)>1e-4]
    print(f"{c:55s} n {len(v):6d} better {better:6d} worse {worse:6d} median change {st.median(diffs):+.4f}  p50 {st.median(x for x,_ in v):.4f}->{st.median(y for _,y in v):.4f}")
print('total better',tb,'worse',tw)
