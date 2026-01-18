/**
 * Create content plan for PLAN-003: DAO Governance Case Study
 * Based on COMM-2: How [DAO Name] Increased Governance Participation 4x
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Create content idea linking to communication
db.run(`
  INSERT INTO content_ideas (
    topic, obvious_angle, unique_angle, angle_justification,
    target_reader, hook_options, based_on_comm_id,
    uniqueness_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')
`, [
  'DAO Governance Case Study: 4x Participation Increase',
  'How we helped a DAO increase governance participation',
  'The hidden cost of anonymous governance: why most DAOs fail at voter turnout (and how to fix it)',
  'Most DAO governance content focuses on mechanisms. This focuses on the people problem: you cannot govern a community you cannot reach.',
  'DAO operators, governance token holders, community managers frustrated by low turnout',
  JSON.stringify([
    '5% governance participation. Sound familiar?',
    'This DAO was losing important votes—not because members disagreed, but because they never saw the proposal.',
    'How 200 targeted DMs changed a DAO\'s governance forever',
    'The wallet identity fix that turned spectators into voters'
  ]),
  2, // COMM-2
  85
]);

const ideaResult = db.exec('SELECT last_insert_rowid() as id');
const ideaId = ideaResult[0].values[0][0];

// Create content plan with governance keywords
db.run(`
  INSERT INTO content_plan (
    idea_id, content_type, title, brief, target_keywords,
    voice_profile_id, quality_bar, priority, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')
`, [
  ideaId,
  'case_study',
  'How a DAO Increased Governance Participation from 5% to 22% Using Wallet Identity',
  'Case study (1000+ words) demonstrating walletlink.social impact on DAO governance. Follow challenge-solution-results structure with placeholder quotes.',
  JSON.stringify([
    'DAO governance',
    'governance participation',
    'token holder engagement',
    'wallet identity DAO',
    'voter turnout crypto',
    'DAO community management',
    'governance quorum'
  ]),
  1, // wallet-to-social voice profile
  'high',
  8 // Priority from PRD
]);

const planResult = db.exec('SELECT last_insert_rowid() as id');
const planId = planResult[0].values[0][0];

// Update communication status to 'assigned'
db.run(`UPDATE communications SET status = 'assigned' WHERE id = 2`);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'ideate',
  'plan_created',
  JSON.stringify({
    story: 'PLAN-003',
    plan_id: planId,
    idea_id: ideaId,
    type: 'case_study',
    linked_comm: 2,
    keywords: 7
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ PLAN-003 Complete: DAO case study planned');
console.log(`   Idea ID: ${ideaId}`);
console.log(`   Plan ID: ${planId}`);
console.log(`   Title: How a DAO Increased Governance Participation from 5% to 22% Using Wallet Identity`);
console.log(`   Type: case_study`);
console.log(`   Keywords: 7 governance-focused keywords`);
console.log(`   COMM-2 status: assigned`);

db.close();
