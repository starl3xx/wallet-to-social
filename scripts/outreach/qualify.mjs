#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare, qualify, MODEL, RUBRIC } from './qualification.mjs';

const [input, output, flag] = process.argv.slice(2);
if (!input || !output || (flag && flag !== '--run')) {
  console.error(
    'Usage: node scripts/outreach/qualify.mjs research.json output.json [--run]\nDefault: offline preview. --run submits selected public excerpts to TypeSafe. Never reads or changes outreach state. Output must not already exist.'
  );
  process.exitCode = 1;
} else {
  try {
    process.umask(0o077);
    const records = JSON.parse(readFileSync(input, 'utf8'));
    if (!Array.isArray(records) || !records.length || records.length > 20)
      throw new Error('Supply 1–20 public research records');
    // Validate the entire batch before any network call or output creation.
    const previews = records.map((record) => prepare(record));
    if (flag === '--run' && !process.env.TYPESAFE_API_KEY)
      throw new Error('Set TYPESAFE_API_KEY in a private environment file');
    const report = {
      mode: flag === '--run' ? 'shadow' : 'offline-preview',
      model: MODEL,
      rubric: RUBRIC,
      warning:
        'Model judgments are advisory. Confidence is not correctness. No sending, approval, or deliverability decision is made.',
      results: [],
    };
    writeFileSync(output, JSON.stringify(report, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
    for (const [i, record] of records.entries()) {
      try {
        report.results.push(
          flag === '--run'
            ? await qualify(record)
            : {
                company: record.company,
                request: previews[i].request,
                claims: previews[i].claims,
              }
        );
      } catch (error) {
        report.results.push({
          company: record.company,
          status: 'evaluation-failed',
          error: error.message,
        });
        process.exitCode = 1;
      }
      writeFileSync(output, JSON.stringify(report, null, 2), { mode: 0o600 });
      if (process.exitCode) break; // Stop a paid batch on provider failure; preserve completed work.
    }
    console.log(
      JSON.stringify({
        output,
        mode: report.mode,
        processed: report.results.length,
      })
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
