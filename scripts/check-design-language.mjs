#!/usr/bin/env node
/**
 * Guards the design language beyond colour.
 *
 * The palette guard covers one primitive. These cover the rest of what a grep can
 * actually see: radius, elevation, arbitrary type sizes, and the uppercase label.
 *
 * Every rule ships with fixtures, because this project has twice had a guard
 * report clean over live violations — once for requiring whitespace before a
 * class, once for omitting six colour families — and both times it had only been
 * checked against code that already passed. A guard verified that way proves
 * nothing.
 *
 * What a grep CANNOT answer, and so is not attempted here: whether a value is the
 * *right* token for its size, whether two components share a class name, or
 * whether the page renders. Those need eyes.
 *
 * Run: node scripts/check-design-language.mjs
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const RULES = [
  {
    name: 'radius',
    // rounded-sm | rounded-lg | rounded-full | rounded-mark are the five.
    re: /(^|[\s"'`])(?:[a-z0-9-]+:)*rounded-(?:md|xl|2xl|3xl|4xl)(?=[\s"'`]|$)/,
    msg: 'Only rounded-sm (chips), rounded-mark (the brand mark), rounded-lg (containers) and rounded-full (controls).',
  },
  {
    name: 'bare-radius',
    re: /(^|[\s"'`])(?:[a-z0-9-]+:)*rounded(?=[\s"'`]|$)/,
    msg: 'Bare `rounded` is 4px and is not on the scale. Use rounded-sm or rounded-lg.',
  },
  {
    name: 'elevation',
    re: /(^|[\s"'`])(?:[a-z0-9-]+:)*shadow-(?:xs|sm|md|2xl)(?=[\s"'`/]|$)/,
    msg: 'Separation is a hairline border. shadow-lg only, and only on the floating layer.',
  },
  {
    name: 'arbitrary-type',
    re: /(^|[\s"'`])(?:[a-z0-9-]+:)*text-\[\d+px\]/,
    msg: 'Arbitrary sizes sit between the scale steps by definition. Use the scale.',
  },
];

/** Whole-line rule: uppercase text must be mono, since there is one label style. */
function uppercaseWithoutMono(line) {
  if (!/(^|[\s"'`])(?:[a-z0-9-]+:)*uppercase(?=[\s"'`]|$)/.test(line)) return false;
  return !line.includes('font-mono');
}

const FIXTURES = {
  radius: { bad: ['rounded-md', 'hover:rounded-xl', 'sm:rounded-2xl', 'p-4 rounded-md border'],
            good: ['rounded-sm', 'rounded-lg', 'rounded-full', 'rounded-mark', 'rounded-[50%]'] },
  'bare-radius': { bad: ['border rounded p-2', 'className="rounded"'],
                   good: ['rounded-sm', 'rounded-lg', 'rounded-full'] },
  elevation: { bad: ['shadow-sm', 'hover:shadow-md', 'shadow-xs'],
               good: ['shadow-lg', 'shadow-none', 'text-shadow-lg'] },
  'arbitrary-type': { bad: ['text-[10px]', 'sm:text-[13px]'],
                      good: ['text-xs', 'text-sm', 'max-w-[68ch]', 'tracking-[0.14em]'] },
};

let failed = 0;
for (const rule of RULES) {
  const f = FIXTURES[rule.name];
  for (const s of f.bad) if (!rule.re.test(s)) { console.error(`FIXTURE FAIL  ${rule.name} missed: ${s}`); failed++; }
  for (const s of f.good) if (rule.re.test(s)) { console.error(`FIXTURE FAIL  ${rule.name} false alarm: ${s}`); failed++; }
}
for (const s of ['uppercase tracking-wider', 'text-xs uppercase'])
  if (!uppercaseWithoutMono(s)) { console.error(`FIXTURE FAIL  uppercase missed: ${s}`); failed++; }
for (const s of ['font-mono text-xs uppercase tracking-[0.14em]', 'text-sm font-medium'])
  if (uppercaseWithoutMono(s)) { console.error(`FIXTURE FAIL  uppercase false alarm: ${s}`); failed++; }

if (failed) {
  console.error(`\n${failed} fixture(s) failed. The guard does not do what it claims.`);
  process.exit(1);
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules' && e !== '.next') walk(p, out); }
    else if (p.endsWith('.tsx') || p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of [...walk('app'), ...walk('components')]) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    // Comments explain the rules and quote the very classes they ban. Three
    // separate checks in this project have been fooled by their own prose.
    const code = line.replace(/\/\*.*?\*\//g, '').replace(/\/\/.*$/, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    if (/^\s*(\*|\/\/|\{?\/\*)/.test(line)) return;
    for (const rule of RULES) if (rule.re.test(code)) hits.push({ file, line: i + 1, rule: rule.name, msg: rule.msg, code: code.trim().slice(0, 90) });
    if (uppercaseWithoutMono(code)) hits.push({ file, line: i + 1, rule: 'uppercase', msg: 'Uppercase text is the eyebrow: font-mono text-xs uppercase tracking-[0.14em]. Use <Eyebrow>.', code: code.trim().slice(0, 90) });
  });
}

if (!hits.length) {
  console.log('design language ok — radius, elevation, type scale and labels all on-system');
  process.exit(0);
}
for (const h of hits) console.error(`${h.file}:${h.line}  [${h.rule}]  ${h.code}\n    ${h.msg}`);
console.error(`\n${hits.length} violation(s). See docs/DESIGN-LANGUAGE.md.`);
process.exit(1);
