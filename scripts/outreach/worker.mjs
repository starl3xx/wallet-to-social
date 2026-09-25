#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

// One process per persistent private data directory. Child commands take the same
// lock as the review CLI; an operator edit makes a tick skip instead of overlapping.
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--send'))
  throw new Error('Use outreach:worker or outreach:worker -- --send');
let stopping = false;
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => {
    stopping = true;
    abort.abort();
  });
while (!stopping) {
  await new Promise((resolve, reject) => {
    // execArgv preserves a caller's --env-file. No shell and no secret interpolation.
    const child = spawn(
      process.execPath,
      [
        ...process.execArgv,
        fileURLToPath(new URL('./cli.mjs', import.meta.url)),
        'tick',
        ...args,
      ],
      { stdio: 'inherit' }
    );
    child.on('error', reject);
    child.on('exit', (code) => {
      console.log(
        JSON.stringify({ at: new Date().toISOString(), tickExitCode: code })
      );
      resolve();
    });
  });
  if (!stopping)
    await setTimeout(5 * 60_000, undefined, { signal: abort.signal }).catch(
      () => {}
    );
}
