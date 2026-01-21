/**
 * Save WRITE-002: Wallet Identity Thought Leadership draft
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const DRAFT_PATH = './content/drafts/wallet-identity-v1.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the draft content
const draftContent = readFileSync(DRAFT_PATH, 'utf-8');
const wordCount = draftContent.split(/\s+/).filter(w => w.length > 0).length;

// Find the plan for PLAN-002 (should be plan_id = 4)
const planResult = db.exec(`SELECT id FROM content_plan WHERE priority = 4 AND content_type = 'blog'`);
const planId = planResult[0].values[0][0];

// Create draft
db.run(`
  INSERT INTO drafts (
    plan_id, version, content, word_count, critique_passed, iteration_notes
  ) VALUES (?, ?, ?, ?, ?, ?)
`, [
  planId,
  1,
  draftContent,
  wordCount,
  false, // Not critiqued yet
  JSON.stringify({
    structure: [
      'Problem setup: wallet identity bottleneck',
      'Match rate data and why it matters',
      'Farcaster inflection point',
      'Concrete example: 22% math',
      'DAO case study preview',
      'Priority Score concept',
      'Infrastructure layer argument',
      'CTA'
    ],
    data_used: [
      '2.5% industry average',
      '22% walletlink.social match rate',
      '9x improvement',
      '500K+ wallets analyzed',
      'Farcaster 10x growth',
      '80% of builders on Farcaster',
      '3x more matches with Farcaster'
    ],
    angles: 'Positioned as infrastructure layer, not just a tool'
  })
]);

// Update plan status to 'writing'
db.run(`UPDATE content_plan SET status = 'writing' WHERE id = ?`, [planId]);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'write',
  'flagship_draft_created',
  JSON.stringify({
    story: 'WRITE-002',
    plan_id: planId,
    word_count: wordCount,
    type: 'thought_leadership',
    file: 'content/drafts/wallet-identity-v1.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ WRITE-002 Complete: Wallet identity thought leadership drafted');
console.log(`   Plan ID: ${planId}`);
console.log(`   Word Count: ${wordCount}`);
console.log(`   File: content/drafts/wallet-identity-v1.md`);

db.close();
