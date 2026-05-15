#!/usr/bin/env node
import { runCli } from '../cli.js';

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`fatal: ${String(err)}\n`);
    process.exit(1);
  },
);
