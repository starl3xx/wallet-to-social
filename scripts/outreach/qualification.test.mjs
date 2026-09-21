import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  prepare,
  qualify,
  callJev,
  validateResponse,
  MODEL,
} from './qualification.mjs';
const now = Date.parse('2026-09-21T12:00:00Z');
const record = {
  company: 'Fictional Agency',
  sourceUrl: 'https://example.org/services',
  observedAt: new Date(now).toISOString(),
  excerpt:
    'We provide community growth services. Our Ethereum wallet audience segmentation case study was published in 2024.',
};
function response(request, pick) {
  return {
    model: MODEL,
    answers: Object.fromEntries(
      Object.entries(request.questions).map(([id, q]) => {
        const selected = pick(id, q);
        return [
          id,
          {
            type: 'choice',
            choice: selected,
            confidence: 1,
            probabilities: Object.fromEntries(
              Object.keys(q.criteria).map((k) => [k, k === selected ? 1 : 0])
            ),
          },
        ];
      })
    ),
    usage: { input_tokens: 100, output_tokens: 20 },
  };
}
test('only allowlisted public research fields leave the process', () => {
  const p = prepare(
    {
      ...record,
      email: 'private@example.org',
      token: 'secret',
      messages: ['private mail'],
    },
    now
  );
  assert.ok(!JSON.stringify(p.request).includes('secret'));
  assert.ok(!JSON.stringify(p.request).includes('private'));
  assert.equal(p.request.model, MODEL);
  assert.ok(p.request.questions.evm.criteria.none);
});
test('stale, future, invalid and failed evidence is rejected', () => {
  for (const change of [
    { observedAt: '2020-01-01' },
    { observedAt: '2027-01-01' },
    { observedAt: 'bad' },
    { status: 'research-failed' },
    { sourceUrl: 'https://example.org/?token=secret' },
  ])
    assert.throws(() => prepare({ ...record, ...change }, now));
});
test('no evidence remains unsupported and cannot become approved', async () => {
  let calls = 0;
  const result = await qualify(record, {
    now,
    evaluate: async (q) => {
      calls++;
      return response(q, () => 'none');
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.supportedSignals, 0);
  assert.equal(result.status, 'human-review-required');
});
test('selected passages undergo a separate support check; fabricated quotes never reach model', async () => {
  let calls = 0;
  const result = await qualify(
    {
      ...record,
      claims: [
        { text: 'You have a campaign this week.', quote: record.excerpt },
        {
          text: 'You have a large budget.',
          quote: 'We spend a million dollars.',
        },
      ],
    },
    {
      now,
      evaluate: async (q) => {
        calls++;
        if (calls === 1) return response(q, () => 'p0');
        assert.ok(!q.questions.claim1);
        return response(q, (id) =>
          id === 'services' ? 'supported' : 'unsupported'
        );
      },
    }
  );
  assert.equal(calls, 2);
  assert.equal(result.supportedSignals, 1);
  assert.equal(result.claims[0].verdict, 'unsupported');
  assert.equal(result.claims[1].verdict, 'missing-quote');
  assert.ok(record.excerpt.includes(result.signals.services.quote));
});
test('malformed output, unknown choices and unexpected model fail closed', () => {
  const q = prepare(record, now).request;
  for (const mutate of [
    (r) => {
      r.model = 'jev-latest';
    },
    (r) => {
      delete r.answers.evm;
    },
    (r) => {
      r.answers.evm.choice = 'invented';
    },
    (r) => {
      r.answers.evm.probabilities.none = 0.2;
    },
    (r) => {
      r.answers.evm.confidence = NaN;
    },
  ]) {
    const r = response(q, () => 'none');
    mutate(r);
    assert.throws(() => validateResponse(r, q.questions));
  }
});
test('HTTP failures do not leak provider body or retry', async () => {
  let count = 0;
  await assert.rejects(
    callJev(prepare(record, now).request, {
      apiKey: 'test-key',
      fetcher: async (url, opts) => {
        count++;
        assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
        assert.equal(opts.redirect, 'error');
        return {
          ok: false,
          status: 429,
          json: () => {
            throw new Error('secret body');
          },
        };
      },
    }),
    /HTTP 429/
  );
  assert.equal(count, 1);
});
test('offline CLI works without key, keeps output private, refuses overwrite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walletlink-jev-'));
  try {
    const input = join(dir, 'input.json');
    const output = join(dir, 'output.json');
    writeFileSync(
      input,
      JSON.stringify([{ ...record, observedAt: new Date().toISOString() }])
    );
    const args = ['scripts/outreach/qualify.mjs', input, output];
    const env = { ...process.env, TYPESAFE_API_KEY: '' };
    const first = spawnSync(process.execPath, args, { env });
    assert.equal(first.status, 0, first.stderr.toString());
    assert.equal(JSON.parse(readFileSync(output)).mode, 'offline-preview');
    assert.equal(spawnSync(process.execPath, args, { env }).status, 1);
    assert.equal(
      spawnSync(
        process.execPath,
        [...args.slice(0, 2), join(dir, 'live.json'), '--run'],
        { env }
      ).status,
      1
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accepts a rounded 0.99 distribution at the 1% tolerance boundary', () => {
  const request = prepare(record, now).request;
  const r = response(request, () => 'none');
  const alternative = Object.keys(request.questions.evm.criteria).find(
    (k) => k !== 'none'
  );
  r.answers.evm.probabilities.none = 0.55;
  r.answers.evm.probabilities[alternative] = 0.44;
  assert.doesNotThrow(() => validateResponse(r, request.questions));
  r.answers.evm.probabilities[alternative] = 0.47;
  assert.throws(
    () => validateResponse(r, request.questions),
    /Invalid TypeSafe probabilities/
  );
});
