import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDataset, summarize, runEvaluation } from './evaluation.mjs';
const now = Date.now();
const row = {
  id: 'a',
  group: 'Example',
  kind: 'public',
  split: 'holdout',
  rationale: 'Labeled before model call',
  record: {
    company: 'Example',
    sourceUrl: 'https://example.org/',
    observedAt: new Date(now).toISOString(),
    excerpt: 'We offer Solana marketing. Ethereum is a competitor ecosystem.',
    claims: [
      {
        text: 'You work on Ethereum.',
        quote: 'Ethereum is a competitor ecosystem.',
      },
    ],
  },
  expected: {
    signals: {
      services: 'supported',
      evm: 'unsupported',
      useCase: 'unsupported',
    },
    claims: ['unsupported'],
  },
};
const dataset = { version: 1, cases: [row] };
const result = {
  signals: {
    services: { verdict: 'supported' },
    evm: { verdict: 'unsupported' },
    useCase: { verdict: 'unsupported' },
  },
  claims: [{ verdict: 'unsupported' }],
};
test('reject duplicate ids, cross-split company leakage and missing labels', () => {
  assert.throws(() => validateDataset({ version: 1, cases: [row, row] }));
  assert.throws(
    () =>
      validateDataset({
        version: 1,
        cases: [row, { ...row, id: 'b', split: 'development' }],
      }),
    /leaks/
  );
  assert.throws(() =>
    validateDataset({ version: 1, cases: [{ ...row, expected: {} }] })
  );
});
test('metrics isolate holdout, synthetic cases and missing evaluations', () => {
  const d = {
    version: 1,
    cases: [
      row,
      { ...row, id: 'b', group: 'Synthetic', kind: 'synthetic' },
      { ...row, id: 'c', group: 'Missing' },
    ],
  };
  const summary = summarize(d, {
    a: { result },
    b: { result: { ...result, claims: [{ verdict: 'supported' }] } },
    c: { error: 'API unavailable' },
  });
  assert.equal(summary['holdout/public'].signals.precision, 1);
  assert.equal(summary['holdout/public'].keywordBaseline.fp, 1);
  assert.equal(summary['holdout/public'].missingOrFailed, 1);
  assert.equal(summary['holdout/public'].claims.fp, 0);
  assert.equal(summary['holdout/synthetic'].claims.fp, 1);
});
test('labels never reach evaluator and completed calls are not repeated on resume', async () => {
  let calls = 0,
    checkpoint;
  const opts = {
    now,
    qualify: async (r, o) => {
      calls++;
      assert.equal(r.expected, undefined);
      assert.equal(r.split, undefined);
      assert.equal(o?.now, now);
      return result;
    },
    save: async (r) => {
      checkpoint = structuredClone(r);
    },
  };
  await runEvaluation(dataset, opts);
  await runEvaluation(dataset, { ...opts, checkpoint });
  assert.equal(calls, 1);
  await assert.rejects(
    runEvaluation({ ...dataset, note: 'changed' }, { ...opts, checkpoint }),
    /does not match/
  );
});
test('provider failures preserve prior results and stop the batch', async () => {
  const d = {
    version: 1,
    cases: [
      row,
      { ...row, id: 'b', group: 'Second' },
      { ...row, id: 'c', group: 'Third' },
    ],
  };
  let calls = 0,
    saved;
  await assert.rejects(
    runEvaluation(d, {
      now,
      qualify: async () => {
        if (++calls === 2) throw new Error('provider unavailable');
        return result;
      },
      save: async (r) => {
        saved = structuredClone(r);
      },
    }),
    /stopped at b/
  );
  assert.equal(calls, 2);
  assert.ok(saved.results.a.result);
  assert.ok(saved.results.b.error);
  assert.equal(saved.summary['holdout/public'].missingOrFailed, 2);
});

test('review includes denominators and distinguishes binary from exact claim verdicts', async () => {
  const { renderEvaluation } = await import('./evaluation.mjs');
  const results = {
    a: { result: { ...result, claims: [{ verdict: 'contradicted' }] } },
  };
  const run = {
    ...validateDataset(dataset),
    results,
    summary: summarize(dataset, results),
  };
  const review = renderEvaluation(dataset, run);
  assert.match(review, /1\/1/);
  assert.match(review, /0\/1/);
  assert.match(review, /not buying intent/);
  assert.match(review, /not independently verified truth/);
});

test('CLI resume regenerates review without API calls and rejects concurrent writers', async () => {
  const { mkdtempSync, writeFileSync, readFileSync, rmSync, statSync } =
    await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'walletlink-eval-'));
  try {
    const input = join(dir, 'labels.json'),
      output = join(dir, 'results.json');
    writeFileSync(input, JSON.stringify(dataset));
    writeFileSync(
      output,
      JSON.stringify({
        ...validateDataset(dataset),
        results: { a: { result } },
      })
    );
    const args = ['scripts/outreach/evaluate.mjs', input, output, '--resume'];
    const env = { ...process.env, TYPESAFE_API_KEY: 'not-a-real-key' };
    const first = spawnSync(process.execPath, args, { env });
    assert.equal(first.status, 0, first.stderr.toString());
    assert.match(
      readFileSync(`${output}.md`, 'utf8'),
      /Jev qualification evaluation/
    );
    assert.equal(statSync(output).mode & 0o777, 0o600);
    writeFileSync(`${output}.lock`, 'other-run');
    const saved = readFileSync(output, 'utf8');
    assert.equal(spawnSync(process.execPath, args, { env }).status, 1);
    assert.equal(readFileSync(output, 'utf8'), saved);
    assert.equal(readFileSync(`${output}.lock`, 'utf8'), 'other-run');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a numeric case id is refused at validation, before a run can checkpoint it', () => {
  assert.throws(
    () => validateDataset({ version: 1, cases: [{ ...row, id: 7 }] }),
    /unique string ID/
  );
  assert.doesNotThrow(() => validateDataset(dataset, now));
});
