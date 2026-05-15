#!/usr/bin/env node
// Bootstrap the cross-page-companion-demo end-to-end:
//   1. pnpm-builds @web-companion/cli (so /cli/exec has a binary to spawn)
//   2. Mints a JWT for user "demo"
//   3. Spawns reference-backend (port 3001) + coffee-shop vite (port 5173)
//
// Pipes both children's stdout/stderr with prefixes; relays Ctrl-C cleanly.

import { spawn, spawnSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const BACKEND_PORT = process.env.BACKEND_PORT ?? '3001';
const SHELL_PORT = process.env.SHELL_PORT ?? '5173';
const SHARED_SECRET = process.env.REFERENCE_BACKEND_SECRET
  ?? 'demo-cross-page-shared-secret';
const USER_ID = 'demo';

// --- Step 1: build the CLI -------------------------------------------------
process.stderr.write('[demo] building @web-companion/cli …\n');
const build = spawnSync('pnpm', ['--filter', '@web-companion/cli', 'build'], {
  cwd: ROOT,
  stdio: 'inherit',
});
if (build.status !== 0) {
  process.stderr.write('[demo] cli build failed — aborting\n');
  process.exit(build.status ?? 1);
}

// --- Step 2: mint a JWT for user "demo" ------------------------------------
process.stderr.write('[demo] minting demo JWT (REFERENCE_BACKEND_SECRET locked in) …\n');
const mint = spawnSync(
  'pnpm',
  ['-s', '--filter', 'reference-backend', 'exec', 'tsx', 'src/sign-token.ts', USER_ID],
  {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, REFERENCE_BACKEND_SECRET: SHARED_SECRET },
  },
);
if (mint.status !== 0) {
  process.stderr.write(
    `[demo] sign-token failed (status ${mint.status}): ${mint.stderr}\n`,
  );
  process.exit(mint.status ?? 1);
}
const token = mint.stdout.trim();
process.stderr.write(`[demo] minted token (${token.length} chars)\n`);

// --- Step 3: spawn both servers --------------------------------------------
function prefix(name, color) {
  const colors = { backend: '\x1b[36m', vite: '\x1b[35m', reset: '\x1b[0m' };
  return `${colors[color] ?? ''}[${name}]${colors.reset}`;
}

function pipeOutput(child, name, color) {
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        process.stderr.write(`${prefix(name, color)} ${line}\n`);
      }
    });
  }
}

const backend = spawn(
  'pnpm',
  ['--filter', 'reference-backend', 'dev'],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: BACKEND_PORT,
      HOST: '127.0.0.1',
      REFERENCE_BACKEND_SECRET: SHARED_SECRET,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
pipeOutput(backend, 'backend', 'backend');

const vite = spawn(
  'pnpm',
  [
    '--filter',
    'coffee-shop',
    'exec',
    'vite',
    '--port',
    SHELL_PORT,
    '--strictPort',
    '--host',
    '127.0.0.1',
  ],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      VITE_BACKEND_URL: `ws://127.0.0.1:${BACKEND_PORT}/ws`,
      VITE_USER_TOKEN: token,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
pipeOutput(vite, 'vite', 'vite');

// --- Banner ----------------------------------------------------------------
setTimeout(() => {
  process.stderr.write(
    '\n' +
    '────────────────────────────────────────────────────────\n' +
    '🐚 Cross-page Companion demo is up\n' +
    `   • Shell:    http://127.0.0.1:${SHELL_PORT}/shell.html\n` +
    `   • Menu:     http://127.0.0.1:${SHELL_PORT}/menu.html\n` +
    `   • Settings: http://127.0.0.1:${SHELL_PORT}/settings.html\n` +
    `   • Backend:  http://127.0.0.1:${BACKEND_PORT}/health\n` +
    '\n' +
    '   sidebar shows up on shell.html. Click MCP / CLI tabs to\n' +
    '   drive the iframe. iframe nav (<a href>) updates the catalog.\n' +
    '   Ctrl-C to stop both processes.\n' +
    '────────────────────────────────────────────────────────\n\n',
  );
}, 1500);

// --- Cleanup ---------------------------------------------------------------
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [backend, vite]) {
    if (child && !child.killed) {
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
    }
  }
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
backend.on('exit', (code) => {
  process.stderr.write(`[demo] backend exited (${code})\n`);
  shutdown(code ?? 0);
});
vite.on('exit', (code) => {
  process.stderr.write(`[demo] vite exited (${code})\n`);
  shutdown(code ?? 0);
});
