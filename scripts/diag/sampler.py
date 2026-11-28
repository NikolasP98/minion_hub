# DIAG ONLY (branch diag/webkit-flake, never merged): per-0.5 s CPU% and RSS of every browser process.
import os, sys, time
root, out = sys.argv[1], sys.argv[2]
tick = os.sysconf('SC_CLK_TCK'); prev = {}
with open(out, 'w', buffering=1) as f:
    while True:
        now = time.time()
        for pid in os.listdir('/proc'):
            if not pid.isdigit(): continue
            try:
                cmd = open(f'/proc/{pid}/cmdline', 'rb').read().split(b'\0')[0].decode(errors='replace')
                if root not in cmd: continue
                st = open(f'/proc/{pid}/stat').read().rsplit(')', 1)[1].split()
                cpu = (int(st[11]) + int(st[12])) / tick
                rss = int(st[21]) * 4096 / 2**20
            except Exception:
                continue
            p = prev.get(pid); prev[pid] = (now, cpu)
            pct = 100 * (cpu - p[1]) / (now - p[0]) if p else 0
            f.write(f'{now:.1f} {pid} {os.path.basename(cmd)} cpu={pct:.0f} rss={rss:.0f}\n')
        time.sleep(0.5)
