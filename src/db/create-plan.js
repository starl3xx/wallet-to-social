/**
 * Create a content plan entry for PLAN-001: Farcaster Integration Launch
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// First, create a content idea for the plan
db.run(`
  INSERT INTO content_ideas (
    topic, obvious_angle, unique_angle, angle_justification,
    target_reader, hook_options, based_on_comm_id, uniqueness_score, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved')
`, [
  'Farcaster Integration Launch',
  'We added Farcaster support to our tool',
  'Farcaster is solving the wallet identity problem that Web3 has ignored for years',
  'Position the integration as part of a larger trend - Farcaster verified addresses make wallet-to-social resolution 3x more effective',
  'Token project founders, DAO operators, community managers who need to reach their holders',
  JSON.stringify([
    'You have 10,000 wallet addresses. Farcaster just made them 3x more reachable.',
    'The wallet identity problem has a new solution: verified Farcaster addresses.',
    '80% of crypto builders are now on Farcaster. Here\'s how to find yours.'
  ]),
  1, // based_on_comm_id
  88
]);

// Get the idea id
const ideaResult = db.exec('SELECT last_insert_rowid() as id');
const ideaId = ideaResult[0].values[0][0];

// Create the content plan
db.run(`
  INSERT INTO content_plan (
    idea_id, content_type, title, brief, target_keywords,
    voice_profile_id, quality_bar, priority, status
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')
`, [
  ideaId,
  'blog',
  'wallet-to-social Now Supports Farcaster: 3x More Wallet Matches',
  `Announce Farcaster integration for wallet-to-social.

Key points to cover:
- Farcaster verified addresses = reliable wallet-to-social linking
- Follower counts included for prioritization
- Verified Twitter handles from Farcaster (more reliable than ENS text records)
- 3x improvement in match rates when Farcaster data is included

Structure: Problem → Farcaster solves it → How we integrated → Results → CTA

Tone: Excited but substantive. Web3-native language. Specific numbers.`,
  JSON.stringify([
    'wallet to social',
    'Farcaster wallet lookup',
    'crypto wallet identity',
    'token holder outreach',
    'Web3 community building',
    'wallet address to Twitter',
    'Farcaster verified addresses',
    'DAO holder engagement'
  ]),
  1, // voice_profile_id
  'high',
  1 // priority
]);

// Get the plan id
const planResult = db.exec('SELECT last_insert_rowid() as id');
const planId = planResult[0].values[0][0];

// Update communication status to 'assigned'
db.run('UPDATE communications SET status = ? WHERE id = ?', ['assigned', 1]);

// Log the activity
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'ideate',
  'content_plan_created',
  JSON.stringify({
    story: 'PLAN-001',
    plan_id: planId,
    idea_id: ideaId,
    content_type: 'blog',
    based_on_comm_id: 1,
    title: 'wallet-to-social Now Supports Farcaster: 3x More Wallet Matches'
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ PLAN-001 Complete: Content plan created');
console.log(`   Plan ID: ${planId}`);
console.log(`   Idea ID: ${ideaId}`);
console.log(`   Type: blog`);
console.log(`   Title: wallet-to-social Now Supports Farcaster: 3x More Wallet Matches`);
console.log(`   Keywords: wallet to social, Farcaster wallet lookup, crypto wallet identity, +5 more`);
console.log(`   Linked to: COMM-1 (now status=assigned)`);

db.close();
