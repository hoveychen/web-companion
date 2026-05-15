import { parseArgs } from 'node:util';
import { connect } from './mcp-client.js';

const USAGE = `companion — invoke web-companion tools over MCP Streamable HTTP

USAGE:
  companion list                       List tools (filtered by current page).
  companion call <tool> [opts]         Invoke a tool by qualified name.

ENV:
  COMPANION_BACKEND   Backend base URL (default http://127.0.0.1:3001)
  COMPANION_TOKEN     JWT to send as Authorization: Bearer ...  (required)

CALL OPTIONS:
  --json '<jsonObj>'   Pass the whole arguments object as JSON.
  --p key=value        Pass one argument (repeatable). Values are parsed as
                       JSON first, falling back to raw string. e.g.
                         --p id=latte
                         --p enabled=true
                         --p count=3
  --backend <url>      Override COMPANION_BACKEND.
  --token <jwt>        Override COMPANION_TOKEN.

EXAMPLES:
  companion list
  companion list --filter cart.
  companion call cart.add_to_cart --p id=latte
  companion call settings.set_nickname --json '{"value":"Alice"}'
`;

interface ListCmd { kind: 'list'; filter?: string }
interface CallCmd {
  kind: 'call';
  tool: string;
  params: Record<string, unknown>;
}
interface HelpCmd { kind: 'help'; exitCode: number }

type Cmd =
  | ListCmd
  | CallCmd
  | HelpCmd;

interface Connection {
  backendBase: string;
  token: string;
}

export async function runCli(argv: readonly string[]): Promise<number> {
  const parsed = parseTopLevel(argv);
  if (parsed.kind === 'help') {
    process.stdout.write(USAGE);
    return parsed.cmd.kind === 'help' ? parsed.cmd.exitCode : 0;
  }

  const conn = resolveConnection(parsed.flags);
  if (!conn) {
    process.stderr.write(
      'error: missing token (set COMPANION_TOKEN or pass --token)\n',
    );
    return 2;
  }

  if (parsed.cmd.kind === 'list') return runList(conn, parsed.cmd);
  if (parsed.cmd.kind === 'call') return runCall(conn, parsed.cmd);
  return 2;
}

async function runList(conn: Connection, cmd: ListCmd): Promise<number> {
  const client = await connect({ backendBase: conn.backendBase, token: conn.token });
  try {
    const tools = await client.listTools();
    // Strip the reference-backend's `<userId>:` multi-tenant prefix from
    // displayed names (the user typically only has one userId per token
    // and the prefix is noise).
    const userId = decodeJwtUserId(conn.token);
    const stripPrefix = userId ? `${userId}:` : null;
    const display = (n: string) =>
      stripPrefix && n.startsWith(stripPrefix) ? n.slice(stripPrefix.length) : n;
    const filtered = cmd.filter
      ? tools.filter((t) => display(t.name).startsWith(cmd.filter!))
      : tools;
    for (const t of filtered) {
      process.stdout.write(`${display(t.name)}\n`);
      if (t.description) process.stdout.write(`  ${t.description}\n`);
    }
    if (filtered.length === 0) {
      process.stderr.write(
        cmd.filter
          ? `(no tools matching prefix "${cmd.filter}")\n`
          : '(no tools active on the current page)\n',
      );
    }
    return 0;
  } finally {
    await client.close();
  }
}

async function runCall(conn: Connection, cmd: CallCmd): Promise<number> {
  const client = await connect({ backendBase: conn.backendBase, token: conn.token });
  // Auto-prefix unqualified tool names with the JWT userId so callers can
  // write `companion call cart.add_to_cart` instead of having to know
  // about reference-backend's `<userId>:` multi-tenant namespacing.
  const qualified = cmd.tool.includes(':')
    ? cmd.tool
    : qualifyToolName(cmd.tool, conn.token);
  try {
    const result = await client.callTool(qualified, cmd.params);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return result.isError ? 1 : 0;
  } catch (err) {
    process.stderr.write(`error: ${String(err)}\n`);
    return 1;
  } finally {
    await client.close();
  }
}

function qualifyToolName(tool: string, jwt: string): string {
  const userId = decodeJwtUserId(jwt);
  return userId ? `${userId}:${tool}` : tool;
}

function decodeJwtUserId(jwt: string): string | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1]!;
    // base64url -> base64 -> utf8
    const padded = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(normalized, 'base64').toString('utf8');
    const decoded = JSON.parse(json) as { userId?: unknown };
    return typeof decoded.userId === 'string' ? decoded.userId : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Arg parsing
// ---------------------------------------------------------------------------

interface ParseResult {
  kind: 'cmd' | 'help';
  cmd: Cmd;
  flags: { backend?: string; token?: string };
  exitCode?: number;
}

function parseTopLevel(argv: readonly string[]): ParseResult {
  if (argv.length === 0) {
    return { kind: 'help', cmd: { kind: 'help', exitCode: 1 }, flags: {} };
  }
  const sub = argv[0];

  if (sub === 'help' || sub === '--help' || sub === '-h') {
    return { kind: 'help', cmd: { kind: 'help', exitCode: 0 }, flags: {} };
  }

  if (sub === 'list') {
    return parseList(argv.slice(1));
  }
  if (sub === 'call') {
    return parseCall(argv.slice(1));
  }

  process.stderr.write(`unknown subcommand: ${sub}\n\n`);
  return { kind: 'help', cmd: { kind: 'help', exitCode: 2 }, flags: {} };
}

function parseList(args: readonly string[]): ParseResult {
  const { values } = parseArgs({
    args: [...args],
    options: {
      filter: { type: 'string' },
      backend: { type: 'string' },
      token: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: false,
    strict: true,
  });
  if (values.help) {
    return { kind: 'help', cmd: { kind: 'help', exitCode: 0 }, flags: {} };
  }
  const cmd: ListCmd = { kind: 'list' };
  if (values.filter !== undefined) cmd.filter = values.filter;
  return {
    kind: 'cmd',
    cmd,
    flags: {
      ...(values.backend !== undefined && { backend: values.backend }),
      ...(values.token !== undefined && { token: values.token }),
    },
  };
}

function parseCall(args: readonly string[]): ParseResult {
  const { values, positionals } = parseArgs({
    args: [...args],
    options: {
      json: { type: 'string' },
      // --p can be repeated; node:util parseArgs supports `multiple: true`.
      p: { type: 'string', multiple: true, short: 'p' },
      backend: { type: 'string' },
      token: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    return { kind: 'help', cmd: { kind: 'help', exitCode: 0 }, flags: {} };
  }
  const tool = positionals[0];
  if (!tool) {
    process.stderr.write('error: `call` requires a tool name\n\n');
    return { kind: 'help', cmd: { kind: 'help', exitCode: 2 }, flags: {} };
  }
  const params = collectParams(values.json, values.p);
  return {
    kind: 'cmd',
    cmd: { kind: 'call', tool, params },
    flags: {
      ...(values.backend !== undefined && { backend: values.backend }),
      ...(values.token !== undefined && { token: values.token }),
    },
  };
}

function collectParams(
  jsonFlag: string | undefined,
  pFlags: string[] | undefined,
): Record<string, unknown> {
  let result: Record<string, unknown> = {};
  if (jsonFlag !== undefined) {
    try {
      const parsed = JSON.parse(jsonFlag);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        result = parsed as Record<string, unknown>;
      } else {
        process.stderr.write('warning: --json must be an object; ignoring\n');
      }
    } catch (err) {
      process.stderr.write(`warning: --json parse failed: ${String(err)}\n`);
    }
  }
  for (const raw of pFlags ?? []) {
    const eq = raw.indexOf('=');
    if (eq === -1) {
      process.stderr.write(`warning: --p flag missing '=': ${raw}\n`);
      continue;
    }
    const key = raw.slice(0, eq);
    const rawValue = raw.slice(eq + 1);
    let v: unknown = rawValue;
    try { v = JSON.parse(rawValue); } catch { /* keep as string */ }
    result[key] = v;
  }
  return result;
}

function resolveConnection(flags: {
  backend?: string;
  token?: string;
}): Connection | null {
  const backendBase =
    flags.backend ??
    process.env['COMPANION_BACKEND'] ??
    'http://127.0.0.1:3001';
  const token = flags.token ?? process.env['COMPANION_TOKEN'];
  if (!token) return null;
  return { backendBase, token };
}
