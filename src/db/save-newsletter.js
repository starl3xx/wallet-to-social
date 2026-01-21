/**
 * Save newsletter for NEWSLETTER-001
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';
const NEWSLETTER_PATH = './content/drafts/newsletter-001.md';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Read the newsletter content
const newsletterContent = readFileSync(NEWSLETTER_PATH, 'utf-8');
const wordCount = newsletterContent.split(/\s+/).filter(w => w.length > 0).length;

// Create content idea
db.run(`
  INSERT INTO content_ideas (
    topic, obvious_angle, unique_angle, angle_justification,
    target_reader, hook_options, uniqueness_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 'approved')
`, [
  'Farcaster Launch Newsletter',
  'Product update email',
  'Valuable newsletter mixing product news with trend insights',
  'Newsletter provides value beyond just announcements - includes trend watch section',
  'Existing users and subscribers interested in Web3 identity trends',
  JSON.stringify([
    'Farcaster just made your token holders 3x more reachable',
    '22% match rate: walletlink.social + Farcaster is live',
    'The wallet identity problem just got easier to solve'
  ]),
  80
]);

const ideaResult = db.exec('SELECT last_insert_rowid() as id');
const ideaId = ideaResult[0].values[0][0];

// Create content plan
db.run(`
  INSERT INTO content_plan (
    idea_id, content_type, title, brief, target_keywords,
    voice_profile_id, quality_bar, priority, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'review')
`, [
  ideaId,
  'newsletter',
  'Farcaster Launch Newsletter',
  'Product update newsletter with trend insights',
  JSON.stringify(['Farcaster', 'token-gated', 'airdrop', 'wallet identity']),
  1,
  'high',
  11
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
  newsletterContent,
  wordCount,
  true,
  JSON.stringify({
    subject_lines: 3,
    sections: ['Product update', 'Trend watch', 'CTA'],
    trends_covered: ['Token-gated communities', 'Airdrop targeting']
  })
]);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'write',
  'newsletter_created',
  JSON.stringify({
    story: 'NEWSLETTER-001',
    plan_id: planId,
    word_count: wordCount,
    subject_lines: 3,
    file: 'content/drafts/newsletter-001.md'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ NEWSLETTER-001 Complete: Newsletter drafted');
console.log(`   Plan ID: ${planId}`);
console.log(`   Word Count: ${wordCount}`);
console.log(`   Subject Lines: 3`);
console.log(`   File: content/drafts/newsletter-001.md`);

db.close();
