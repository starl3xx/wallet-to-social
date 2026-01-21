/**
 * METRICS-001: Log final content metrics and learnings
 */

import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync, readdirSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Gather metrics
const draftsResult = db.exec('SELECT COUNT(*) as count, SUM(word_count) as words FROM drafts');
const totalDrafts = draftsResult[0].values[0][0];
const totalWords = draftsResult[0].values[0][1];

const publishedResult = db.exec('SELECT COUNT(*) as count FROM published');
const totalPublished = publishedResult[0].values[0][0];

const plansResult = db.exec('SELECT COUNT(*) as count FROM content_plan');
const totalPlans = plansResult[0].values[0][0];

// Content breakdown
const breakdown = {
  blogs: 2,
  case_studies: 1,
  newsletters: 1,
  social_batches: 1,
  social_posts: 5
};

// Calculate files
const draftFiles = readdirSync('./content/drafts').filter(f => f.endsWith('.md'));
const publishedFiles = readdirSync('./content/published').filter(f => f.endsWith('.md'));

// Log final summary to agent_log
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'publish',
  'sprint_complete',
  JSON.stringify({
    story: 'METRICS-001',
    sprint: 'content-sprint-1',
    total_content_pieces: totalDrafts,
    total_word_count: totalWords,
    published_pieces: totalPublished,
    content_plans: totalPlans,
    breakdown: breakdown,
    files_created: {
      drafts: draftFiles,
      published: publishedFiles
    },
    stories_completed: [
      'SETUP-001', 'PLAN-001', 'WRITE-001', 'REVIEW-001', 'PUBLISH-001',
      'SOCIAL-001', 'NEWSLETTER-001', 'PLAN-002', 'WRITE-002', 'PLAN-003', 'WRITE-003', 'METRICS-001'
    ],
    effective_patterns: [
      'Problem-first hooks with specific numbers',
      'Data tables for comparisons (match rates, before/after)',
      'Competitor comparison sections',
      'Challenge → Discovery → Solution → Results for case studies',
      'Specific metrics throughout (22%, 9x, 4x)',
      'Web3-native tone: direct, builder-focused, no fluff'
    ]
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('╔══════════════════════════════════════════════════════════════╗');
console.log('║         RALPH CONTENT SPRINT 1 - FINAL METRICS               ║');
console.log('╠══════════════════════════════════════════════════════════════╣');
console.log('║                                                              ║');
console.log(`║  Total Content Pieces: ${totalDrafts}                                   ║`);
console.log(`║  Total Word Count: ${totalWords}                                  ║`);
console.log(`║  Published Pieces: ${totalPublished}                                      ║`);
console.log('║                                                              ║');
console.log('║  CONTENT BREAKDOWN                                           ║');
console.log('║  ────────────────                                            ║');
console.log('║  • 2 Blog Posts (flagship + launch announcement)             ║');
console.log('║  • 1 Case Study (DAO governance)                             ║');
console.log('║  • 1 Newsletter (launch update)                              ║');
console.log('║  • 5 Social Posts (Twitter/Farcaster)                        ║');
console.log('║                                                              ║');
console.log('║  STORIES COMPLETED: 12/12                                    ║');
console.log('║  ────────────────────────                                    ║');
console.log('║  ✅ SETUP-001    ✅ PLAN-001     ✅ WRITE-001                 ║');
console.log('║  ✅ REVIEW-001   ✅ PUBLISH-001  ✅ SOCIAL-001                ║');
console.log('║  ✅ NEWSLETTER-001              ✅ PLAN-002                   ║');
console.log('║  ✅ WRITE-002    ✅ PLAN-003     ✅ WRITE-003                 ║');
console.log('║  ✅ METRICS-001                                              ║');
console.log('║                                                              ║');
console.log('╚══════════════════════════════════════════════════════════════╝');

db.close();
