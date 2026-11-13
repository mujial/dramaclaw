#!/usr/bin/env node
'use strict';

/*
 * free-short-video — npm launcher
 *
 * Installs/runs the full Agnes Video Generator (Python/FastAPI) service on the
 * user's machine with zero manual setup beyond a Python 3.10+ interpreter:
 *   1. detect python3 >= 3.10
 *   2. create a venv inside the package
 *   3. pip install -r requirements.txt  (pulls moviepy + imageio-ffmpeg)
 *   4. expose imageio-ffmpeg's static ffmpeg binary on PATH (no system ffmpeg needed)
 *   5. spawn `python server.py` with PORT/HOST + optional AGNES_API_KEY
 *   6. auto-open the browser, forward Ctrl+C for graceful shutdown
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PKG_ROOT = path.resolve(__dirname, '..');

// 终端超链接（ANSI OSC 8）：TTY 下输出可点击链接，非 TTY（管道/重定向）降级为纯文本
const link = (url, text) =>
  process.stdout.isTTY ? `\x1b]8;;${url}\x1b\\${text}\x1b]8;;\x1b\\` : text;

// 启动图案（ASCII art）：TTY 下亮青色显示，非 TTY 纯文本
const FSV_LOGO = String.raw`   _____ ______     __
  |  ___/ ___\ \   / /
  | |_  \___ \\ \ / /
  |  _|  ___) |\ V /
  |_|   |____/  \_/`.split('\n');
function printLogo() {
  if (process.stdout.isTTY) {
    console.log('\x1b[1;36m');
    FSV_LOGO.forEach((l) => console.log(l));
    process.stdout.write('\x1b[0m');
  } else {
    console.log('');
    FSV_LOGO.forEach((l) => console.log(l));
  }
}

function printHelp() {
  console.log(`free-short-video — free AI short-video generator

Usage:
  npx free-short-video [options]
  fsv [options]

Options:
  --port <n>       Listen port (default 8765)
  --host <h>       Bind host (default 127.0.0.1; use 0.0.0.0 for LAN)
  --home <dir>     Data root (default $AGNES_HOME or ~/.agnes-video)
  --no-open        Do not auto-open the browser
  --detach         Start in the background and exit once the service answers
  --json           Machine-readable result (implies --detach)
  --print-paths    Print where config/workspace/venv live, then exit
  -h, --help       Show this help

Environment:
  AGNES_API_KEY  Your Agnes API key (can also be set later in the Web UI)
  AGNES_HOME     Data root: venv, config, workspace, logs (default ~/.agnes-video)

Website:
  ${link('https://video.lichuanyang.top', 'https://video.lichuanyang.top')}   (official site & no-install online demo)

First run creates a venv under the data root and installs Python dependencies.
Later runs reuse it; pip only runs again when requirements.txt actually changes.
`);
}

// ── parse args ────────────────────────────────────────────────────────────
let port = 8765;
let host = '127.0.0.1';
let openBrowser = true;
let detach = false;
let jsonOutput = false;
let printPaths = false;
let homeOverride = '';

const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--port') {
    const v = parseInt(argv[++i], 10);
    if (!Number.isNaN(v)) port = v;
  } else if (a === '--host') {
    host = argv[++i] || host;
  } else if (a === '--home') {
    homeOverride = argv[++i] || '';
  } else if (a === '--no-open') {
    openBrowser = false;
  } else if (a === '--detach') {
    detach = true;
  } else if (a === '--json') {
    jsonOutput = true;
    detach = true;
  } else if (a === '--print-paths') {
    printPaths = true;
  } else if (a === '-h' || a === '--help') {
    printHelp();
    process.exit(0);
  } else {
    console.error(`Unknown option: ${a}\n`);
    printHelp();
    process.exit(1);
  }
}

// ── data root ─────────────────────────────────────────────────────────────
// Everything mutable lives under one directory so that an npm cache clean (or a
// version bump, which swaps the npx package directory) never re-downloads the
// Python dependencies. Legacy installs that used PKG_ROOT/.venv keep working.
const HOME = path.resolve(
  (homeOverride || process.env.AGNES_HOME || path.join(os.homedir(), '.agnes-video')).trim(),
);
const LEGACY_VENV = path.join(PKG_ROOT, '.venv');
const VENV_DIR = fs.existsSync(path.join(HOME, 'venv'))
  ? path.join(HOME, 'venv')
  : (fs.existsSync(LEGACY_VENV) ? LEGACY_VENV : path.join(HOME, 'venv'));
const CONFIG_DIR = path.join(HOME, 'config');
const WORKSPACE_DIR = path.join(HOME, 'workspace');
const LOG_DIR = path.join(HOME, 'logs');
const REQ_MARKER = path.join(VENV_DIR, '.agnes-req.sha256');

function ensureDirs() {
  for (const dir of [HOME, CONFIG_DIR, WORKSPACE_DIR, LOG_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * 老版本把配置放在包目录（.agnes_config）。改用数据根后，首次运行把旧配置
 * 复制过去，避免用户因为"换了目录"而丢掉已配置的 API Key 与偏好。
 * 只做一次（新目录已有 config.json 就跳过），失败不阻断启动。
 */
function migrateLegacyConfig() {
  const legacyDir = path.join(PKG_ROOT, '.agnes_config');
  const legacyFile = path.join(legacyDir, 'config.json');
  const target = path.join(CONFIG_DIR, 'config.json');
  if (fs.existsSync(target) || !fs.existsSync(legacyFile)) return;
  try {
    fs.cpSync(legacyDir, CONFIG_DIR, { recursive: true });
    console.log(`✓ Migrated existing config from ${legacyDir}`);
  } catch (_) {
    console.log('⚠ Could not migrate the previous config; the key can be re-entered in the Web UI');
  }
}

if (printPaths) {
  const payload = {
    home: HOME,
    venv: VENV_DIR,
    config: CONFIG_DIR,
    workspace: WORKSPACE_DIR,
    logs: LOG_DIR,
    package: PKG_ROOT,
    node: process.version,
  };
  if (jsonOutput) console.log(JSON.stringify(payload));
  else {
    for (const [k, v] of Object.entries(payload)) console.log(`${k}: ${v}`);
  }
  process.exit(0);
}

// ── helpers ───────────────────────────────────────────────────────────────
function run(cmd, opts) {
  return execSync(cmd, Object.assign({ stdio: 'inherit', cwd: PKG_ROOT }, opts));
}

function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const out = execSync(`"${cmd}" --version`, { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
      const m = out.match(/Python (\d+)\.(\d+)/);
      if (m && (parseInt(m[1], 10) > 3 || (parseInt(m[1], 10) === 3 && parseInt(m[2], 10) >= 10))) {
        return cmd;
      }
    } catch (_) {
      /* not found / wrong version */
    }
  }
  return null;
}

function venvBin(name) {
  return process.platform === 'win32'
    ? path.join(VENV_DIR, 'Scripts', `${name}.exe`)
    : path.join(VENV_DIR, 'bin', name);
}

/** 依赖指纹：requirements.txt 未变时跳过 pip，避免每次启动都联网解析 */
function requirementsSha() {
  try {
    return require('crypto')
      .createHash('sha256')
      .update(fs.readFileSync(path.join(PKG_ROOT, 'requirements.txt')))
      .digest('hex');
  } catch (_) {
    return '';
  }
}

// ── 1. python check ───────────────────────────────────────────────────────
console.log('================================================');
printLogo();
console.log('   free-short-video — Free AI short-video generator');
console.log('');
console.log(`   🌐 官网: ${link('https://video.lichuanyang.top', 'https://video.lichuanyang.top')}  |  ⚡ 在线体验: ${link('https://video.lichuanyang.top/demo', 'https://video.lichuanyang.top/demo')}`);
console.log('================================================');
console.log('');

const py = findPython();
if (!py) {
  console.error('❌ Python 3.10+ is required but was not found.');
  console.error('   macOS:   brew install python3');
  console.error('   Ubuntu:  sudo apt install python3 python3-venv');
  console.error('   Windows: https://www.python.org/downloads/');
  process.exit(1);
}
console.log(`✓ Using ${py}`);

const venvPython = venvBin('python');
const venvPip = venvBin('pip');

// ── 2. venv + deps ─────────────────────────────────────────────────────────
ensureDirs();
migrateLegacyConfig();
if (!fs.existsSync(venvPython)) {
  console.log('[1/3] Creating virtual environment...');
  run(`"${py}" -m venv "${VENV_DIR}"`);
}

const reqSha = requirementsSha();
const reqMarker = (() => {
  try {
    return fs.readFileSync(REQ_MARKER, 'utf8').trim();
  } catch (_) {
    return '';
  }
})();

if (reqSha && reqSha === reqMarker) {
  console.log('[2/3] Python dependencies already installed (requirements unchanged)');
} else {
  console.log('[2/3] Installing Python dependencies (first run only)...');
  run(`"${venvPip}" install -q --upgrade-strategy only-if-needed -r "${path.join(PKG_ROOT, 'requirements.txt')}"`, {
    env: process.env,
  });
  if (reqSha) {
    try {
      fs.writeFileSync(REQ_MARKER, reqSha);
    } catch (_) {
      /* fingerprint is an optimisation; never fail the startup because of it */
    }
  }
}

// ── 3. ffmpeg via imageio-ffmpeg (no system ffmpeg required) ──────────────
let ffmpegDir = null;
try {
  const exe = execSync(`"${venvPython}" -c "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"`, {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  if (exe) ffmpegDir = path.dirname(exe);
} catch (_) {
  /* imageio-ffmpeg missing is non-fatal; system ffmpeg may still work */
}
if (ffmpegDir) {
  console.log('✓ Using bundled ffmpeg (imageio-ffmpeg)');
} else {
  console.log('⚠ No bundled ffmpeg found; relying on system ffmpeg in PATH');
}

// ── 4. launch server ──────────────────────────────────────────────────────
const BASE = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
const env = Object.assign({}, process.env, {
  HOST: host,
  PORT: String(port),
  // Keep config, workspace and logs inside the data root so an npm cache clean
  // or a package upgrade cannot take the user's data with it.
  AGNES_CONFIG_DIR: CONFIG_DIR,
  AGNES_WORKING_DIR: WORKSPACE_DIR,
  AGNES_LOG_FILE: path.join(LOG_DIR, 'agnes.log'),
});
if (ffmpegDir) {
  env.PATH = ffmpegDir + path.delimiter + (env.PATH || '');
}
if (process.env.AGNES_API_KEY) {
  env.AGNES_API_KEY = process.env.AGNES_API_KEY;
}

function probeReady(timeoutMs, onReady) {
  const http = require('http');
  const deadline = Date.now() + timeoutMs;
  const tick = () => {
    const req = http.get(`${BASE}/api/config`, (res) => {
      res.resume();
      if (res.statusCode === 200) onReady(true);
      else retry();
    });
    req.setTimeout(2000, () => {
      req.destroy();
      retry();
    });
    req.on('error', retry);
    function retry() {
      if (Date.now() > deadline) onReady(false);
      else setTimeout(tick, 500);
    }
  };
  tick();
}

if (detach) {
  const logPath = path.join(LOG_DIR, 'npm-cli.log');
  const out = fs.openSync(logPath, 'a');
  const child = spawn(venvPython, ['server.py'], {
    cwd: PKG_ROOT,
    env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  probeReady(90000, (ready) => {
    const payload = {
      ok: ready,
      ready,
      pid: child.pid,
      base: BASE,
      home: HOME,
      venv: VENV_DIR,
      workspace: WORKSPACE_DIR,
      log: logPath,
    };
    if (jsonOutput) console.log(JSON.stringify(payload));
    else {
      console.log(ready ? '✓ Service is up' : '✗ Service did not answer within 90s');
      console.log(`  url:  ${BASE}`);
      console.log(`  pid:  ${child.pid}`);
      console.log(`  home: ${HOME}`);
      console.log(`  log:  ${logPath}`);
    }
    process.exit(ready ? 0 : 1);
  });
} else {
  console.log('[3/3] Starting service...');
  console.log('');
  console.log(`  Web UI will be at ${BASE}`);
  console.log(`  Data root: ${HOME}`);
  console.log('  Press Ctrl+C to stop.');
  console.log('');

  const child = spawn(venvPython, ['server.py'], {
    cwd: PKG_ROOT,
    env,
    stdio: 'inherit',
  });

  child.on('exit', (code) => {
    process.exit(code === null ? 0 : code);
  });

  const shutdown = (sig) => {
    if (child.exitCode === null) child.kill(sig);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ── auto-open browser ─────────────────────────────────────────────────────
// 轮询等待服务就绪（HTTP 200）后再打开浏览器，避免启动初期闪现"无法访问"
// detach 模式由 --json/--detach 的调用方决定是否需要 UI，这里不抢焦点
if (openBrowser && !detach) {
  const http = require('http');
  const url = `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${port}`;
  let attempts = 0;

  const openBrowserNow = () => {
    try {
      if (process.platform === 'darwin') execSync(`open "${url}"`);
      else if (process.platform === 'win32') execSync(`start "" "${url}"`);
      else execSync(`xdg-open "${url}"`);
    } catch (_) {
      /* browser open is best-effort */
    }
  };

  const scheduleNext = () => {
    if (++attempts > 120) return; // 约 60s 上限，超时不再尝试
    setTimeout(pollReady, 500);
  };

  const pollReady = () => {
    const req = http.get(url, (res) => {
      res.resume();
      if (res.statusCode >= 200 && res.statusCode < 500) openBrowserNow();
      else scheduleNext();
    });
    req.setTimeout(2000, () => {
      req.destroy();
      scheduleNext();
    });
    req.on('error', scheduleNext);
  };

  pollReady();
}
