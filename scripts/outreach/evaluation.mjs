import { createHash } from 'node:crypto';
import { MODEL, RUBRIC, SIGNALS, prepare } from './qualification.mjs';

export const hash = (value) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const signalKeys = Object.keys(SIGNALS);
const verdicts = ['supported', 'unsupported', 'contradicted', 'missing-quote'];
export function validateDataset(dataset, now = Date.now()) {
  if (
    dataset?.version !== 1 ||
    !Array.isArray(dataset.cases) ||
    !dataset.cases.length ||
    dataset.cases.length > 200
  )
    throw new Error('Evaluation requires version 1 and 1–200 labeled cases');
  const ids = new Set(),
    groups = new Map();
  for (const c of dataset.cases) {
    if (
      !c.id ||
      ids.has(c.id) ||
      !c.group ||
      !['development', 'holdout'].includes(c.split) ||
      !['public', 'synthetic', 'extraction-limited'].includes(c.kind) ||
      !c.rationale
    )
      throw new Error(
        'Case needs unique ID, group, split, kind and annotation rationale'
      );
    ids.add(c.id);
    if (groups.has(c.group) && groups.get(c.group) !== c.split)
      throw new Error('Company group leaks across splits');
    groups.set(c.group, c.split);
    prepare(c.record, now);
    if (
      signalKeys.some(
        (k) => !['supported', 'unsupported'].includes(c.expected?.signals?.[k])
      ) ||
      !Array.isArray(c.expected?.claims) ||
      c.expected.claims.length !== (c.record.claims ?? []).length ||
      c.expected.claims.some((v) => !verdicts.includes(v))
    )
      throw new Error('Missing or invalid expected labels');
  }
  return {
    datasetHash: hash(dataset),
    cases: dataset.cases.length,
    groups: groups.size,
    model: MODEL,
    rubric: RUBRIC,
  };
}
// Deliberately simple lexical baseline, not an established buying-intent model.
export function keywordBaseline(record) {
  const s = record.excerpt;
  return {
    services: /marketing|audience analytics|community (growth|building)/i.test(
      s
    ),
    evm: /\b(Ethereum|EVM|Base|Polygon|Arbitrum|Optimism|Mantle)\b/i.test(s),
    useCase:
      /wallet holders?|audience segment|campaign attribution|on.?chain attribution|wallet.{0,25}attribution|on.?chain.{0,25}community/i.test(
        s
      ),
  };
}
function metric(pairs) {
  const tp = pairs.filter(([e, a]) => e && a).length;
  const fp = pairs.filter(([e, a]) => !e && a).length;
  const fn = pairs.filter(([e, a]) => e && !a).length;
  const tn = pairs.length - tp - fp - fn;
  return {
    total: pairs.length,
    tp,
    fp,
    fn,
    tn,
    precision: tp + fp ? tp / (tp + fp) : null,
    recall: tp + fn ? tp / (tp + fn) : null,
    accuracy: pairs.length ? (tp + tn) / pairs.length : null,
  };
}
export function summarize(dataset, results) {
  const summaries = {};
  for (const split of ['development', 'holdout'])
    for (const kind of ['public', 'synthetic', 'extraction-limited']) {
      const cases = dataset.cases.filter(
        (c) => c.split === split && c.kind === kind
      );
      if (!cases.length) continue;
      const modelPairs = [],
        baselinePairs = [],
        claimPairs = [],
        disagreements = [];
      const perSignal = Object.fromEntries(signalKeys.map((key) => [key, []]));
      let completed = 0,
        claimsExact = 0,
        claimsTotal = 0;
      for (const c of cases) {
        const entry = results[c.id];
        if (!entry?.result) continue;
        completed++;
        const baseline = keywordBaseline(c.record);
        for (const key of signalKeys) {
          const expected = c.expected.signals[key] === 'supported';
          const actual = entry.result.signals[key].verdict === 'supported';
          modelPairs.push([expected, actual]);
          perSignal[key].push([expected, actual]);
          baselinePairs.push([expected, baseline[key]]);
          if (actual !== expected)
            disagreements.push({
              id: c.id,
              question: key,
              expected: c.expected.signals[key],
              actual: entry.result.signals[key].verdict,
            });
        }
        for (const [i, expected] of c.expected.claims.entries()) {
          const actual = entry.result.claims[i].verdict;
          claimsTotal++;
          if (actual === expected) claimsExact++;
          claimPairs.push([expected === 'supported', actual === 'supported']);
          if (expected !== actual)
            disagreements.push({
              id: c.id,
              question: `claim${i}`,
              expected,
              actual,
            });
        }
      }
      summaries[`${split}/${kind}`] = {
        cases: cases.length,
        completed,
        missingOrFailed: cases.length - completed,
        signals: metric(modelPairs),
        perSignal: Object.fromEntries(
          signalKeys.map((k) => [k, metric(perSignal[k])])
        ),
        keywordBaseline: metric(baselinePairs),
        claims: {
          ...metric(claimPairs),
          exactCorrect: claimsExact,
          exactTotal: claimsTotal,
        },
        disagreements,
      };
    }
  return summaries;
}
export async function runEvaluation(
  dataset,
  { qualify, checkpoint, save, now = Date.now() }
) {
  const manifest = validateDataset(dataset, now);
  const run = checkpoint ?? {
    ...manifest,
    startedAt: new Date(now).toISOString(),
    results: {},
  };
  if (
    run.datasetHash !== manifest.datasetHash ||
    run.model !== MODEL ||
    run.rubric !== RUBRIC ||
    !run.results
  )
    throw new Error('Checkpoint does not match dataset, model or rubric');
  for (const id of Object.keys(run.results))
    if (!dataset.cases.some((c) => c.id === id))
      throw new Error('Unknown checkpoint case');
  for (const c of dataset.cases) {
    if (run.results[c.id]?.result) continue;
    const start = performance.now();
    try {
      run.results[c.id] = {
        result: await qualify(c.record),
        elapsedMs: performance.now() - start,
      };
    } catch (error) {
      run.results[c.id] = {
        error: error.message,
        elapsedMs: performance.now() - start,
      };
    }
    run.summary = summarize(dataset, run.results);
    await save(run);
    if (run.results[c.id].error)
      throw new Error(
        `Evaluation stopped at ${c.id}: ${run.results[c.id].error}`
      );
  }
  run.summary = summarize(dataset, run.results);
  await save(run);
  return run;
}

export function renderEvaluation(dataset, run) {
  const esc = (value) =>
    String(value)
      .replace(/[\r\n|]/g, ' ')
      .replace(/[<>]/g, '');
  const pct = (value) =>
    value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
  const lines = [
    '# Jev qualification evaluation',
    '',
    `Model: ${run.model}. Rubric: ${run.rubric}. Dataset: ${run.datasetHash}.`,
    '',
    'Advisory only. No lead import, approval, or sending changes. Company sources and synthetic challenges are reported separately. Results compare against supplied annotations, not independently verified truth.',
    '',
    `Annotation method: ${esc(dataset.annotationMethod || 'Not specified')}`,
    '',
    '| Split / kind | Completed | Signal precision | Signal recall | Signal accuracy | Keyword accuracy | Claims accepted/rejected correctly | Exact claim verdict |',
    '|---|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [name, s] of Object.entries(run.summary))
    lines.push(
      `| ${name} | ${s.completed}/${s.cases} | ${pct(s.signals.precision)} | ${pct(s.signals.recall)} | ${pct(s.signals.accuracy)} | ${pct(s.keywordBaseline.accuracy)} | ${s.claims.tp + s.claims.tn}/${s.claims.total} | ${s.claims.exactCorrect}/${s.claims.exactTotal} |`
    );
  lines.push(
    '',
    'Precision/recall concern supported signals, not buying intent. Missing or failed evaluations are excluded from accuracy denominators and shown in completion counts. Unsupported and contradicted both reject a claim; exact verdict agreement is shown separately. No confidence threshold was calibrated. No manual time-savings or revenue measurement was performed.',
    '',
    '## Disagreements',
    ''
  );
  for (const [name, s] of Object.entries(run.summary))
    for (const d of s.disagreements)
      lines.push(
        `- ${name}: ${esc(d.id)} / ${d.question}: expected ${d.expected}, received ${d.actual}.`
      );
  lines.push(
    '',
    '## Review queue',
    '',
    '| Company | Split / kind | Services | EVM | Use case | Source |',
    '|---|---|---|---|---|---|'
  );
  for (const c of dataset.cases) {
    const r = run.results[c.id]?.result;
    lines.push(
      `| ${esc(c.record.company)} | ${c.split} / ${c.kind} | ${signalKeys.map((key) => r?.signals[key]?.verdict || 'not evaluated').join(' | ')} | ${esc(c.record.sourceUrl)} |`
    );
  }
  lines.push(
    '',
    'Input excerpts, selected quotations, probabilities and annotations remain in the private JSON files. These are source-support decisions: self-published assertions are not independent verification of commercial results.',
    ''
  );
  return lines.join('\n');
}
