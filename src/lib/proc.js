import { spawnSync, spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const isWindows = process.platform === 'win32';

/**
 * Windows has no `which`, so the old `sh('which', cmd)` probe reported every
 * tool as missing even when it was installed and on PATH — `native-sim up`
 * died with "GitHub CLI not found" on machines where gh worked fine.
 * Resolve against PATH ourselves instead: no subprocess, same answer on
 * every platform.
 */
export function resolve(cmd) {
  if (cmd.includes('/') || (isWindows && cmd.includes('\\'))) {
    return isExecutable(cmd) ? cmd : null;
  }

  // PATHEXT is what makes `gh` mean `gh.exe` and `agent-device` mean
  // `agent-device.cmd`; on POSIX the only candidate is the bare name.
  const pathext = isWindows
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [];
  // A command that already carries one of those extensions is tried as-is.
  const exts = !isWindows || pathext.some((e) => e.toUpperCase() === extname(cmd).toUpperCase())
    ? ['']
    : pathext;

  // PATH only, never the working directory: cmd.exe would search `.` first,
  // which would let a checked-out repo shadow gh or git with its own binary.
  const delimiter = isWindows ? ';' : ':';
  for (const dir of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const candidate = join(dir, cmd + ext);
      if (isExecutable(candidate)) return candidate;
    }
  }
  return null;
}

function isExecutable(path) {
  try {
    if (!statSync(path).isFile()) return false;
    // X_OK is meaningless on Windows: every readable file reports executable,
    // which is why the PATHEXT filter above carries the check there.
    accessSync(path, isWindows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * `.cmd`/`.bat` shims — how npm installs CLIs like agent-device and how the
 * MSI installs aws on Windows — are scripts, not executables, so spawn cannot
 * run them directly. Route those through cmd.exe, quoting the arguments here
 * rather than letting cmd.exe re-split a path that contains spaces.
 */
function spawnArgs(cmd, args) {
  const path = resolve(cmd);
  if (!path) return { file: cmd, args, opts: {} };
  if (!isWindows || !/\.(cmd|bat)$/i.test(path)) return { file: path, args, opts: {} };
  return {
    file: process.env.COMSPEC ?? 'cmd.exe',
    args: ['/d', '/s', '/c', `"${[path, ...args].map(quote).join(' ')}"`],
    opts: { windowsVerbatimArguments: true },
  };
}

const quote = (arg) => (/[\s"]/.test(arg) ? `"${String(arg).replace(/"/g, '""')}"` : String(arg));

/** Run a command, capture output. Never throws. */
export function sh(cmd, args = [], opts = {}) {
  const spec = spawnArgs(cmd, args);
  const r = spawnSync(spec.file, spec.args, { encoding: 'utf8', ...spec.opts, ...opts });
  return {
    ok: r.status === 0,
    code: r.status,
    out: (r.stdout ?? '').trim(),
    err: (r.stderr ?? '').trim(),
  };
}

/** Run a command, capture output, throw on non-zero. */
export function shx(cmd, args = [], opts = {}) {
  const r = sh(cmd, args, opts);
  if (!r.ok) {
    throw new Error(`${cmd} ${args.join(' ')} failed (${r.code})\n${r.err || r.out}`);
  }
  return r.out;
}

/** Run a command with inherited stdio (user sees live output). */
export function run(cmd, args = [], opts = {}) {
  const spec = spawnArgs(cmd, args);
  const r = spawnSync(spec.file, spec.args, { stdio: 'inherit', ...spec.opts, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} exited ${r.status}`);
}

export function has(cmd) {
  return resolve(cmd) !== null;
}

export function open(url) {
  // `open` is macOS-only. Without a listener the ENOENT on other platforms
  // surfaces as an uncaught exception *after* the session is already up.
  const [cmd, args] = isWindows
    ? [process.env.COMSPEC ?? 'cmd.exe', ['/d', '/s', '/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
