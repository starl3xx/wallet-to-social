/**
 * Save draft to database for WRITE-001
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const DRAFT_PATH = './content/drafts/farcaster-integration-v1.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the draft content
const draftContent = readFileSync(DRAFT_PATH, 'utf-8');

// Count words
const wordCount = draftContent.split(/\s+/).filter(w => w.length > 0).length;

// Insert draft
db.run(`
  INSERT INTO drafts (
    plan_id, version, content, word_count, critique, critique_passed, iteration_notes
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
`, [
  1, // plan_id
  1, // version
  draftContent,
  wordCount,
  null, // critique - to be filled in REVIEW-001
  false,
  'First draft. Covers all key messages from COMM-1. Includes competitor comparison section.'
]);

// Get draft id
const draftResult = db.exec('SELECT last_insert_rowid() as id');
const draftId = draftResult[0].values[0][0];

// Update content plan status to 'writing'
db.run('UPDATE content_plan SET status = ? WHERE id = ?', ['writing', 1]);

// Log the activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'write',
  'draft_created',
  JSON.stringify({
    story: 'WRITE-001',
    draft_id: draftId,
    plan_id: 1,
    version: 1,
    word_count: wordCount,
    file: 'content/drafts/farcaster-integration-v1.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ WRITE-001 Complete: Draft saved');
console.log(`   Draft ID: ${draftId}`);
console.log(`   Plan ID: 1`);
console.log(`   Version: 1`);
console.log(`   Word Count: ${wordCount}`);
console.log(`   File: content/drafts/farcaster-integration-v1.md`);
console.log(`   Plan Status: writing`);

db.close();
