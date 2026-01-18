/**
 * Save WRITE-003: DAO Governance Case Study draft
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const DRAFT_PATH = './content/drafts/dao-governance-case-study-v1.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the draft content
const draftContent = readFileSync(DRAFT_PATH, 'utf-8');
const wordCount = draftContent.split(/\s+/).filter(w => w.length > 0).length;

// Find the plan for PLAN-003 (should be plan_id = 5)
const planResult = db.exec(`SELECT id FROM content_plan WHERE priority = 8 AND content_type = 'case_study'`);
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
  true,
  JSON.stringify({
    structure: 'Challenge → Discovery → Solution → Results',
    metrics: [
      '5.2% → 22.4% participation (4.3x)',
      '34% match rate',
      '41% response rate on outreach',
      '6.2 days → 18 hours to quorum',
      '12% improvement in retention'
    ],
    quotes: 3,
    tables: 3,
    has_cta: true
  })
]);

// Update plan status
db.run(`UPDATE content_plan SET status = 'review' WHERE id = ?`, [planId]);

// Update communication status to completed
db.run(`UPDATE communications SET status = 'completed' WHERE id = 2`);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'write',
  'case_study_created',
  JSON.stringify({
    story: 'WRITE-003',
    plan_id: planId,
    word_count: wordCount,
    type: 'case_study',
    file: 'content/drafts/dao-governance-case-study-v1.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ WRITE-003 Complete: DAO governance case study drafted');
console.log(`   Plan ID: ${planId}`);
console.log(`   Word Count: ${wordCount}`);
console.log(`   Structure: Challenge → Discovery → Solution → Results`);
console.log(`   File: content/drafts/dao-governance-case-study-v1.md`);

db.close();
