/**
 * Model kodu için OS yalıtımı (yerel figürler: py/figure_render.py). AST kara listesi tek başına yeterli değildir
 * (kütüphaneler dizeyi `eval` edebilir); asıl sınır budur:
 *
 *   setpriv --no-new-privs [--reuid/--regid nobody: worker root ise] --
 *     unshare --user --map-root-user --mount --pid --fork --mount-proc --net --ipc --uts --kill-child --
 *       sh -c '<maskeler>; tmpfs /tmp; cd /tmp; exec unshare --user --map-user=1000 … -- env -i … python3 -I -c <betik>'
 *
 *   - yeni pid ad alanı + yeni /proc: worker ve öteki süreçler görünmez (`/proc/<pid>/environ` okunamaz),
 *   - ağ ad alanı: arayüz yok (ağa çıkış yok),
 *   - /home /root /app /tmp /run /opt … boş tmpfs ile örtülür (python ve kütüphaneleri hariç); çalışma dizini
 *     yazılabilir 64 MB tmpfs,
 *   - ikinci (iç) kullanıcı ad alanında süreç kök değildir ve yetkisi yoktur: örtüler kaldırılamaz (`umount`),
 *   - ortam boştur (`env -i`); sır taşımaz.
 *
 * Yalıtım kurulamayan makinede (kullanıcı ad alanı kapalı, util-linux yok) `figureIsolation()` neden döner; çağıran
 * güvenilmeyen (model) kodu çalıştırmaz. Yalnız güvenilir kod (sahte LLM fikstürü) yalıtımsız çalışabilir.
 */
import { execFile } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';

const MASK_CANDIDATES = ['/home', '/root', '/app', '/tmp', '/var/tmp', '/run', '/srv', '/mnt', '/media', '/opt', '/workspace', '/workspaces'];

const INNER_SH = `set -eu
py="$1"; src="$2"; shift 2
for d in "$@"; do mount -t tmpfs -o size=1m,mode=755,nosuid,nodev tmpfs "$d"; done
mount -t tmpfs -o size=64m,mode=1777,nosuid,nodev tmpfs /tmp
cd /tmp
exec unshare --user --map-user=1000 --map-group=1000 -- env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp MPLCONFIGDIR=/tmp/.mpl LANG=C.UTF-8 MPLBACKEND=Agg "$py" -I -c "$src"`;

export interface IsolatedCommand {
  command: string;
  args: string[];
}

export type Isolation = { ok: true; python: string; masks: string[] } | { ok: false; reason: string };

const python = () => process.env.OGRENMEN_PYTHON || 'python3';

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, killSignal: 'SIGKILL', env: { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8' }, maxBuffer: 1 << 20 }, (err, out, stderr) => {
      resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, out: String(out), err: String(stderr || (err?.message ?? '')) });
    });
  });
}

/** Yalıtım komutu: `python -I -c <src>` OS yalıtımı içinde (stdin/stdout aynen geçer). */
export function isolatedCommand(iso: Extract<Isolation, { ok: true }>, src: string): IsolatedCommand {
  const root = typeof process.getuid === 'function' && process.getuid() === 0;
  return {
    command: 'setpriv',
    args: [
      '--no-new-privs',
      ...(root ? ['--reuid=65534', '--regid=65534', '--clear-groups'] : []),
      '--',
      'unshare', '--user', '--map-root-user', '--mount', '--pid', '--fork', '--mount-proc', '--net', '--ipc', '--uts', '--kill-child', '--',
      'sh', '-c', INNER_SH, 'sh', iso.python, src, ...iso.masks,
    ],
  };
}

/** Python ve kütüphanelerinin yolları örtülmemeli; geri kalan aday dizinler (+ worker'ın çalışma dizini) örtülür. */
async function planMasks(py: string): Promise<{ python: string; masks: string[] } | string> {
  // korunacak yollar: yorumlayıcı, standart kütüphane ve matplotlib/numpy ile bağımlılıklarının site dizinleri
  const keep = [
    'import json, os, sys, sysconfig, importlib',
    'mods = ["matplotlib", "matplotlib.pyplot", "numpy", "dateutil", "pyparsing", "PIL", "kiwisolver", "cycler", "contourpy", "fontTools", "packaging", "six"]',
    'paths = [sys.executable, os.path.realpath(sys.executable), sys.prefix, sys.base_prefix, sysconfig.get_paths()["stdlib"], sysconfig.get_paths()["platstdlib"]]',
    'for m in mods:',
    '    try:',
    '        f = importlib.import_module(m).__file__',
    '    except Exception:',
    '        continue',
    '    if f: paths.append(os.path.dirname(os.path.dirname(os.path.realpath(f))))',
    'print(json.dumps(paths))',
  ].join('\n');
  const probe = await run(py, ['-I', '-c', keep], 20_000);
  if (probe.code !== 0) return `python/matplotlib çalışmadı: ${probe.err.trim().slice(-200)}`;
  let paths: string[];
  try {
    paths = (JSON.parse(probe.out.trim()) as string[]).filter((p) => typeof p === 'string' && p.startsWith('/'));
  } catch {
    return 'python yolları okunamadı';
  }
  const exe = paths[0]!;
  const resolved = [...paths, ...paths.map((p) => (existsSync(p) ? realpathSync(p) : p))].filter((p) => p !== '/');
  const top = `/${process.cwd().split('/')[1] ?? ''}`;
  const candidates = [...new Set([...MASK_CANDIDATES, top, process.cwd()])].filter((d) => d !== '/' && existsSync(d));
  const open = candidates.filter((d) => !resolved.some((p) => p === d || p.startsWith(`${d}/`)));
  const masks = open.filter((d) => !open.some((o) => o !== d && d.startsWith(`${o}/`)));
  return { python: exe, masks };
}

let cached: Promise<Isolation> | null = null;

/** Yalıtım kurulabiliyor mu (süreç başına bir kez denenir). */
export function figureIsolation(): Promise<Isolation> {
  cached ??= (async (): Promise<Isolation> => {
    const plan = await planMasks(python());
    if (typeof plan === 'string') return { ok: false, reason: plan };
    const iso = { ok: true as const, ...plan };
    const src = 'import os, socket\nimport matplotlib, numpy\nimport matplotlib.pyplot\nassert [p for p in os.listdir("/proc") if p.isdigit()] == ["1"]\ntry:\n    socket.create_connection(("1.1.1.1", 53), 1)\n    print("net")\nexcept OSError:\n    print("ok")\n';
    const cmd = isolatedCommand(iso, src);
    const r = await run(cmd.command, cmd.args, 20_000);
    if (r.code === 0 && r.out.trim() === 'ok') return iso;
    return { ok: false, reason: `OS yalıtımı kurulamadı (setpriv/unshare, kullanıcı ad alanı): ${(r.out + r.err).trim().slice(-200) || `çıkış ${r.code}`}` };
  })();
  return cached;
}

/** Testler: önbelleği sıfırlar. */
export function resetFigureIsolation(): void {
  cached = null;
}
