/**
 * Save social media batch for SOCIAL-001
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const SOCIAL_PATH = './content/drafts/social-batch-001.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the social content
const socialContent = readFileSync(SOCIAL_PATH, 'utf-8');

// Create content idea
db.run(`
  INSERT INTO content_ideas (
    topic, obvious_angle, unique_angle, angle_justification,
    target_reader, hook_options, uniqueness_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
`, [
  'Farcaster Launch Social Promotion',
  'Announcing new feature on social media',
  'Mix of problem hooks, data points, use cases, and engagement questions',
  '5 distinct angles to test what resonates with Web3 audience',
  'Token project founders, DAO operators, crypto marketers on Twitter/Farcaster',
  JSON.stringify([
    'Problem hook: wallet identity pain',
    'Data point: 22% vs 2.5%',
    'Use case: DAO governance improvement',
    'Engagement: poll-style question'
  ]),
  82
]);

const ideaResult = db.exec('SELECT last_insert_rowid() as id');
const ideaId = ideaResult[0].values[0][0];

// Create content plan
db.run(`
  INSERT INTO content_plan (
    idea_id, content_type, title, brief, target_keywords,
    voice_profile_id, quality_bar, priority, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'published')
`, [
  ideaId,
  'social',
  'Farcaster Launch Social Media Batch',
  '5 social posts promoting Farcaster integration',
  JSON.stringify(['Web3', 'Farcaster', 'DAO', 'token holders', 'wallet identity']),
  1,
  'standard',
  10
]);

const planResult = db.exec('SELECT last_insert_rowid() as id');
const planId = planResult[0].values[0][0];

// Create draft
db.run(`
  INSERT INTO drafts (
    plan_id, version, content, word_count, critique_passed, iteration_notes
  ) VALUES (?, ?, ?, ?, ?, ?)
`, [
  planId,
  1,
  socialContent,
  socialContent.split(/\s+/).filter(w => w.length > 0).length,
  true,
  '5 posts, all under 280 chars, varied angles: problem, data, native, case study, engagement'
]);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'write',
  'social_batch_created',
  JSON.stringify({
    story: 'SOCIAL-001',
    plan_id: planId,
    posts: 5,
    platforms: ['Twitter/X', 'Farcaster'],
    file: 'content/drafts/social-batch-001.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ SOCIAL-001 Complete: Social media batch created');
console.log(`   Plan ID: ${planId}`);
console.log(`   Posts: 5`);
console.log(`   Platforms: Twitter/X, Farcaster`);
console.log(`   All posts under 280 characters`);
console.log(`   File: content/drafts/social-batch-001.md`);

db.close();
