#!/usr/bin/env node
import readline from 'node:readline';
import { OriginStore } from './origin-store.js';
import { BridgeWsServer, type UnknownOriginPolicy } from './ws-server.js';
import { createMcpServer } from './mcp-server.js';

const DEFAULT_PORT = 8765;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (cmd === '-h' || cmd === '--help' || cmd === undefined) {
    process.stderr.write(usage());
    process.exit(cmd === undefined ? 1 : 0);
  }
  if (cmd === 'allow' || cmd === 'deny') {
    runVerdictCommand(cmd, argv[1]);
    return;
  }
  if (cmd === 'revoke') {
    runRevokeCommand(argv[1]);
    return;
  }
  if (cmd === 'list') {
    runListCommand();
    return;
  }
  if (cmd === 'start') {
    await runStartCommand(argv.slice(1));
    return;
  }
  process.stderr.write(`web-companion-bridge: unknown command '${cmd}'\n\n${usage()}`);
  process.exit(2);
}

function usage(): string {
  return [
    'Usage: web-companion-bridge <command> [options]',
    '',
    'Commands:',
    '  start [--port <n>] [--host <addr>] [--no-mcp]',
    '       Run the WebSocket + stdio MCP server. Default port 8765. With',
    "       --no-mcp the bridge stays foreground and uses stdin to prompt",
    '       for unknown-origin authorization.',
    '',
    '  allow <origin>',
    '  deny  <origin>',
    '       Persist a verdict to ~/.web-companion/origins.json. The runtime',
    '       consults this file on every incoming hello.',
    '',
    '  revoke <origin>',
    '       Remove an origin from the allowlist/denylist.',
    '',
    '  list',
    '       Show current rules.',
    '',
  ].join('\n');
}

function runVerdictCommand(verdict: 'allow' | 'deny', origin: string | undefined): void {
  if (!origin) {
    process.stderr.write(`web-companion-bridge ${verdict}: missing <origin>\n`);
    process.exit(2);
  }
  const store = new OriginStore();
  store.set(origin, verdict);
  process.stdout.write(
    `${verdict === 'allow' ? '+' : '-'} ${origin}\nwrote ${OriginStore.defaultPath()}\n`,
  );
}

function runRevokeCommand(origin: string | undefined): void {
  if (!origin) {
    process.stderr.write('web-companion-bridge revoke: missing <origin>\n');
    process.exit(2);
  }
  const store = new OriginStore();
  const removed = store.remove(origin);
  if (removed) {
    process.stdout.write(`revoked ${origin}\n`);
  } else {
    process.stderr.write(`no rule for ${origin}\n`);
    process.exit(1);
  }
}

function runListCommand(): void {
  const store = new OriginStore();
  const rules = store.list();
  if (rules.length === 0) {
    process.stdout.write('(no rules)\n');
    return;
  }
  for (const { origin, verdict } of rules) {
    process.stdout.write(`${verdict === 'allow' ? '+' : '-'} ${origin}\n`);
  }
}

interface StartArgs {
  port: number;
  host: string;
  noMcp: boolean;
}

function parseStartArgs(argv: string[]): StartArgs {
  const out: StartArgs = { port: DEFAULT_PORT, host: '127.0.0.1', noMcp: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--port' && argv[i + 1]) {
      out.port = Number.parseInt(argv[++i] ?? '', 10);
    } else if (a === '--host' && argv[i + 1]) {
      out.host = argv[++i] ?? out.host;
    } else if (a === '--no-mcp') {
      out.noMcp = true;
    }
  }
  return out;
}

async function runStartCommand(argv: string[]): Promise<void> {
  const args = parseStartArgs(argv);
  const store = new OriginStore();

  const unknownOriginPolicy: UnknownOriginPolicy = args.noMcp
    ? { type: 'prompt', onPrompt: makeStdinPrompt() }
    : { type: 'deny' };

  const bridge = new BridgeWsServer({
    port: args.port,
    host: args.host,
    originStore: store,
    unknownOriginPolicy,
  });
  await bridge.whenReady();
  const addr = bridge.address();
  process.stderr.write(
    `[web-companion] ws listening on ws://${addr?.host ?? args.host}:${addr?.port ?? args.port} (policy=${unknownOriginPolicy.type})\n`,
  );

  if (!args.noMcp) {
    const { connect } = createMcpServer(bridge);
    await connect();
    process.stderr.write('[web-companion] stdio MCP server attached\n');
  }
}

function makeStdinPrompt() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
    terminal: true,
  });

  return async (ctx: { origin: string; pageUrl: string; tabTitle: string }) => {
    const answer = await new Promise<string>((resolve) => {
      rl.question(
        `> origin=${ctx.origin || '<unknown>'} (page=${ctx.pageUrl || '/'}) requests control.\n  [a]llow once / [A]llow always / [d]eny / [D]eny always : `,
        (a) => resolve(a.trim()),
      );
    });
    switch (answer) {
      case 'a':
        return { verdict: 'allow' as const, persist: false };
      case 'A':
        return { verdict: 'allow' as const, persist: true };
      case 'D':
        return { verdict: 'deny' as const, persist: true };
      case 'd':
      default:
        return { verdict: 'deny' as const, persist: false };
    }
  };
}

main().catch((err) => {
  process.stderr.write(
    `web-companion-bridge: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
