#!/usr/bin/env node
import { readFileSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { qualify } from './qualification.mjs';
import {
  validateDataset,
  runEvaluation,
  renderEvaluation,
} from './evaluation.mjs';

const [input, output, mode] = process.argv.slice(2);
let locked = false;
function savePrivate(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, value, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, filename);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}
try {
  if (!input || !output || !['--preview', '--run', '--resume'].includes(mode))
    throw new Error(
      'Usage: node scripts/outreach/evaluate.mjs labeled.json results.json --preview|--run|--resume'
    );
  process.umask(0o077);
  const dataset = JSON.parse(readFileSync(input, 'utf8'));
  const manifest = validateDataset(dataset);
  if (mode === '--preview') console.log(JSON.stringify(manifest, null, 2));
  else {
    if (!process.env.TYPESAFE_API_KEY)
      throw new Error('Set TYPESAFE_API_KEY in a private environment file');
    writeFileSync(`${output}.lock`, String(process.pid), {
      flag: 'wx',
      mode: 0o600,
    });
    locked = true;
    const checkpoint =
      mode === '--resume' ? JSON.parse(readFileSync(output, 'utf8')) : null;
    if (!checkpoint)
      writeFileSync(
        output,
        JSON.stringify({ ...manifest, results: {} }, null, 2),
        { flag: 'wx', mode: 0o600 }
      );
    const run = await runEvaluation(dataset, {
      qualify,
      checkpoint,
      save: async (value) =>
        savePrivate(output, JSON.stringify(value, null, 2)),
    });
    savePrivate(`${output}.md`, renderEvaluation(dataset, run));
    console.log(
      JSON.stringify(
        { output, review: `${output}.md`, ...manifest, summary: run.summary },
        null,
        2
      )
    );
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (locked) unlinkSync(`${output}.lock`);
}
