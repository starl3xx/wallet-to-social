/**
 * Create content plan for PLAN-002: Wallet Identity Thought Leadership
 * Combines TREND-1 (Farcaster Growth) + RESEARCH-1 (Match Rate Benchmarks)
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Create content idea linking trend and research
db.run(`
  INSERT INTO content_ideas (
    topic, obvious_angle, unique_angle, angle_justification,
    target_reader, hook_options, based_on_trend_id, based_on_research_id,
    uniqueness_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved')
`, [
  'Wallets Are the New Social Profiles',
  'Explaining what wallet identity resolution is',
  'The shift from anonymous wallets to verified identities is the biggest unlock for Web3 marketing',
  'Most content explains HOW to do wallet lookups. This explains WHY wallets becoming identities changes everything for token projects, DAOs, and NFT collections.',
  'Token project founders, DAO operators, Web3 marketers who have wallet lists but cannot reach their holders',
  JSON.stringify([
    'You have 10,000 wallet addresses. Who are these people?',
    'The wallet identity problem is quietly being solved. Here\'s what it means for your project.',
    '2.5% to 22%: The match rate gap that separates spray-and-pray from precision Web3 marketing',
    'Farcaster didn\'t just grow 10x. It made wallet identity actually work.'
  ]),
  1, // TREND-1: Farcaster Growth
  1, // RESEARCH-1: Match Rate Benchmarks
  88
]);

const ideaResult = db.exec('SELECT last_insert_rowid() as id');
const ideaId = ideaResult[0].values[0][0];

// Create content plan with SEO keywords
db.run(`
  INSERT INTO content_plan (
    idea_id, content_type, title, brief, target_keywords,
    voice_profile_id, quality_bar, priority, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')
`, [
  ideaId,
  'blog',
  'Wallets Are the New Social Profiles: Why Web3 Identity Changes Everything',
  'Long-form thought leadership (1500+ words) establishing wallet-to-social resolution as essential infrastructure for Web3 marketing. Uses Farcaster growth trend + match rate research to build the case.',
  JSON.stringify([
    'wallet identity',
    'Web3 marketing',
    'Farcaster wallet lookup',
    'token holder engagement',
    'DAO member outreach',
    'wallet-to-social resolution',
    'NFT holder identification',
    'crypto CRM',
    'airdrop targeting'
  ]),
  1, // wallet-to-social voice profile
  'flagship', // This is the anchor content piece
  4 // Priority from PRD
]);

const planResult = db.exec('SELECT last_insert_rowid() as id');
const planId = planResult[0].values[0][0];

// Update trend status to 'used'
db.run(`UPDATE trends SET status = 'used' WHERE id = 1`);

// Update research status to 'used'
db.run(`UPDATE research SET status = 'used' WHERE id = 1`);

// Log activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'ideate',
  'plan_created',
  JSON.stringify({
    story: 'PLAN-002',
    plan_id: planId,
    idea_id: ideaId,
    type: 'thought_leadership',
    linked_trend: 1,
    linked_research: 1,
    keywords: 9,
    quality_bar: 'flagship'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ PLAN-002 Complete: Wallet identity thought leadership planned');
console.log(`   Idea ID: ${ideaId}`);
console.log(`   Plan ID: ${planId}`);
console.log(`   Title: Wallets Are the New Social Profiles: Why Web3 Identity Changes Everything`);
console.log(`   Type: blog (flagship)`);
console.log(`   Keywords: 9 SEO keywords targeting Web3 identity`);
console.log(`   Linked: TREND-1 (Farcaster Growth) + RESEARCH-1 (Match Rate Benchmarks)`);

db.close();
