/**
 * Publish content for PUBLISH-001
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const PUBLISHED_PATH = './content/published/farcaster-integration-final.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the published content
const finalContent = readFileSync(PUBLISHED_PATH, 'utf-8');

// Create published entry
db.run(`
  INSERT INTO published (
    plan_id, draft_id, final_content, meta_description, final_version, iterations_required
  ) VALUES (?, ?, ?, ?, ?, ?)
`, [
  1, // plan_id
  2, // draft_id (v2)
  finalContent,
  'Farcaster integration brings 3x more wallet matches. Find your token holders\' Twitter and Farcaster profiles instantly. 22% match rate vs 2.5% average.',
  2, // final_version
  2  // iterations_required
]);

// Get published id
const pubResult = db.exec('SELECT last_insert_rowid() as id');
const publishedId = pubResult[0].values[0][0];

// Update plan status to 'published'
db.run('UPDATE content_plan SET status = ? WHERE id = ?', ['published', 1]);

// Update communication status to 'completed'
db.run('UPDATE communications SET status = ? WHERE id = ?', ['completed', 1]);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'publish',
  'content_published',
  JSON.stringify({
    story: 'PUBLISH-001',
    published_id: publishedId,
    plan_id: 1,
    comm_id: 1,
    title: 'walletlink.social Now Supports Farcaster: 3x More Wallet Matches',
    file: 'content/published/farcaster-integration-final.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ PUBLISH-001 Complete: First content published!');
console.log(`   Published ID: ${publishedId}`);
console.log(`   Title: walletlink.social Now Supports Farcaster`);
console.log(`   File: content/published/farcaster-integration-final.md`);
console.log(`   Plan Status: published`);
console.log(`   COMM-1 Status: completed`);

db.close();
