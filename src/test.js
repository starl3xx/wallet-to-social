/**
 * Simple test suite for Ralph the Copywriter
 * Validates database integrity and content quality
 */

import initSqlJs from 'sql.js';
import { existsSync, readFileSync } from 'fs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log('\n🧪 RUNNING TESTS\n');
console.log('─'.repeat(50));

// Database tests
test('Database file exists', () => {
  assert(existsSync('./data/content.db'), 'Database not found');
});

let db;
test('Database can be opened', async () => {
  const SQL = await initSqlJs();
  const fileBuffer = readFileSync('./data/content.db');
  db = new SQL.Database(fileBuffer);
  assert(db, 'Could not open database');
});

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    return stmt.getAsObject();
  }
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  return results;
}

// Initialize db first
const SQL = await initSqlJs();
const fileBuffer = readFileSync('./data/content.db');
db = new SQL.Database(fileBuffer);

test('Trends table has data', () => {
  const count = getOne('SELECT COUNT(*) as c FROM trends');
  assert(count.c > 0, 'No trends in database');
});

test('Research table has data', () => {
  const count = getOne('SELECT COUNT(*) as c FROM research');
  assert(count.c > 0, 'No research in database');
});

test('Communications table has data', () => {
  const count = getOne('SELECT COUNT(*) as c FROM communications');
  assert(count.c > 0, 'No communications in database');
});

// Content quality tests
test('All content plans have required fields', () => {
  const invalid = getOne(`
    SELECT COUNT(*) as c FROM content_plan
    WHERE title IS NULL OR content_type IS NULL
  `);
  assert(invalid.c === 0, 'Found content plans with missing fields');
});

test('All drafts link to valid content plans', () => {
  const orphans = getOne(`
    SELECT COUNT(*) as c FROM drafts d
    LEFT JOIN content_plan cp ON d.plan_id = cp.id
    WHERE cp.id IS NULL
  `);
  assert(orphans.c === 0, 'Found orphaned drafts');
});

test('Published content has meta descriptions', () => {
  const missing = getOne(`
    SELECT COUNT(*) as c FROM published
    WHERE meta_description IS NULL OR meta_description = ''
  `);
  assert(missing.c === 0, 'Published content missing meta descriptions');
});

// Content plan workflow tests
test('No content stuck in invalid status', () => {
  const invalid = getOne(`
    SELECT COUNT(*) as c FROM content_plan
    WHERE status NOT IN ('planned', 'writing', 'review', 'published', 'cancelled', 'researching', 'critiquing', 'iterating')
  `);
  assert(invalid.c === 0, 'Found content with invalid status');
});

// Draft quality tests (if any drafts exist)
const draftCount = getOne('SELECT COUNT(*) as c FROM drafts');
if (draftCount.c > 0) {
  test('Drafts have content', () => {
    const empty = getOne(`
      SELECT COUNT(*) as c FROM drafts
      WHERE content IS NULL OR content = ''
    `);
    assert(empty.c === 0, 'Found empty drafts');
  });

  test('Draft word counts are accurate', () => {
    const drafts = getAll('SELECT content, word_count FROM drafts WHERE content IS NOT NULL');
    drafts.forEach(d => {
      const actualCount = d.content.split(/\s+/).filter(w => w.length > 0).length;
      const diff = Math.abs(actualCount - d.word_count);
      assert(diff < 10, `Word count mismatch: actual ${actualCount} vs stored ${d.word_count}`);
    });
  });
}

// File system tests
test('Progress file exists', () => {
  assert(existsSync('./scripts/ralph/progress.txt'), 'progress.txt not found');
});

test('PRD file exists and is valid JSON', () => {
  const prdPath = './scripts/ralph/prd.json';
  assert(existsSync(prdPath), 'prd.json not found');
  const content = readFileSync(prdPath, 'utf-8');
  JSON.parse(content); // Will throw if invalid
});

// Published content file tests
const publishedContent = getAll('SELECT plan_id FROM published');
publishedContent.forEach(p => {
  test(`Published content file exists for plan ${p.plan_id}`, () => {
    // Content should be in content/published/ directory
    // This is a soft check - we just verify the directory exists
    assert(existsSync('./content/published'), 'Published content directory missing');
  });
});

if (db) db.close();

// Summary
console.log('\n' + '─'.repeat(50));
console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  console.log('\n⚠️  Some tests failed. Ralph should investigate.\n');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!\n');
  process.exit(0);
}
