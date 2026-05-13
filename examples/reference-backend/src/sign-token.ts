#!/usr/bin/env node
import jwt from 'jsonwebtoken';

const SECRET = process.env['REFERENCE_BACKEND_SECRET'] ?? 'dev-secret-DO-NOT-USE-IN-PROD';

function usage(): string {
  return [
    'Usage: tsx src/sign-token.ts <userId> [--exp <duration>]',
    '',
    'Mints a HS256 JWT for the reference backend. The userId is the only',
    'claim the server cares about — both the page sdk and the desktop MCP',
    'client must present a token containing the same userId to be routed',
    'to each other.',
    '',
    'Options:',
    '  --exp <duration>   Token lifetime (e.g. "1h", "7d"). Default "1d".',
    '',
    'Environment:',
    '  REFERENCE_BACKEND_SECRET   Shared HS256 secret. Must match the server.',
    '                             Defaults to a placeholder — set it in prod.',
    '',
  ].join('\n');
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
    process.stderr.write(usage());
    process.exit(args.length === 0 ? 1 : 0);
  }

  const userId = args[0]!;
  let expiresIn: string = '1d';
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--exp' && args[i + 1]) {
      expiresIn = args[i + 1]!;
      i++;
    }
  }

  if (SECRET === 'dev-secret-DO-NOT-USE-IN-PROD') {
    process.stderr.write(
      '[reference-backend] WARNING: signing with placeholder secret. Set REFERENCE_BACKEND_SECRET for anything real.\n',
    );
  }

  const token = jwt.sign({ userId }, SECRET, {
    algorithm: 'HS256',
    expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
  });
  process.stdout.write(token + '\n');
}

main();
