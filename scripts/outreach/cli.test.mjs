import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('CLI imports, reviews, approves, previews and reports without credentials', () => {
  const directory = mkdtempSync(join(tmpdir(), 'outreach-cli-'));
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const execute = (...args) =>
    spawnSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, OUTREACH_DATA_DIR: directory },
    });
  const run = (...args) => {
    const result = execute(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  try {
    const config = join(directory, 'config.json');
    writeFileSync(
      config,
      JSON.stringify({
        sender: 'sender@example.org',
        senderName: 'Operator',
        signature: 'WalletLink',
      })
    );
    assert.equal(run('init', config).paused, true);
    const prospects = join(directory, 'prospects.json');
    const rows = JSON.parse(
      readFileSync(new URL('./prospects.example.json', import.meta.url), 'utf8')
    );
    rows[0].observedAt = new Date().toISOString();
    writeFileSync(prospects, JSON.stringify(rows));
    assert.equal(run('import', prospects).inserted, 1);
    assert.equal(run('plan').drafted, 1);
    const review = readFileSync(run('review').review, 'utf8');
    const [, id, hash] = review.match(/approve ([\w-]+) ([a-f0-9]{64})/);
    assert.equal(run('approve', id, hash).approved, id);
    assert.equal(run('tick').due.length, 1);
    assert.equal(run('tick', '--send').mode, 'paused');
    run('resume');
    const refused = execute('tick', '--send');
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /OUTREACH_DATABASE_URL/);
    run('stop', id, 'replied');
    assert.equal(run('tick').due.length, 0);
    run('revenue', id, 'payment-test', '9900');
    assert.equal(run('report')[0].revenueCents, 9900);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
