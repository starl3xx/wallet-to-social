import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    return stmt.getAsObject();
  }
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  return results;
}

console.log('\n📊 CONTENT PIPELINE STATUS');
console.log('═'.repeat(50));

// Trends
const trendsActive = getOne('SELECT COUNT(*) as count FROM trends WHERE status = ?', ['active']);
const trendsUsed = getOne('SELECT COUNT(*) as count FROM trends WHERE status = ?', ['used']);
console.log(`\n🔥 TRENDS`);
console.log(`   Active: ${trendsActive?.count || 0} | Used: ${trendsUsed?.count || 0}`);

// Research
const researchAvailable = getOne('SELECT COUNT(*) as count FROM research WHERE status = ?', ['available']);
const researchUsed = getOne('SELECT COUNT(*) as count FROM research WHERE status = ?', ['used']);
console.log(`\n🔬 RESEARCH`);
console.log(`   Available: ${researchAvailable?.count || 0} | Used: ${researchUsed?.count || 0}`);

// Communications
const commsPending = getOne('SELECT COUNT(*) as count FROM communications WHERE status = ?', ['pending']);
const commsAssigned = getOne('SELECT COUNT(*) as count FROM communications WHERE status = ?', ['assigned']);
const commsCompleted = getOne('SELECT COUNT(*) as count FROM communications WHERE status = ?', ['completed']);
console.log(`\n📢 COMMUNICATIONS`);
console.log(`   Pending: ${commsPending?.count || 0} | Assigned: ${commsAssigned?.count || 0} | Completed: ${commsCompleted?.count || 0}`);

// Content Plan
const planStatuses = getAll(`
  SELECT status, COUNT(*) as count
  FROM content_plan
  GROUP BY status
`);
console.log(`\n📝 CONTENT PLAN`);
if (planStatuses.length === 0) {
  console.log('   No content planned yet');
} else {
  planStatuses.forEach(s => console.log(`   ${s.status}: ${s.count}`));
}

// Drafts
const draftCount = getOne('SELECT COUNT(*) as count FROM drafts');
const latestDrafts = getAll(`
  SELECT d.id, cp.title, d.version, d.word_count, d.updated_at
  FROM drafts d
  JOIN content_plan cp ON d.plan_id = cp.id
  ORDER BY d.updated_at DESC
  LIMIT 3
`);
console.log(`\n✏️  DRAFTS (${draftCount?.count || 0} total)`);
if (latestDrafts.length > 0) {
  latestDrafts.forEach(d => {
    console.log(`   - "${d.title}" v${d.version} (${d.word_count} words)`);
  });
}

// Published
const publishedCount = getOne('SELECT COUNT(*) as count FROM published');
console.log(`\n✅ PUBLISHED: ${publishedCount?.count || 0} pieces`);

// Recent Activity
const recentLogs = getAll(`
  SELECT action, details, created_at
  FROM agent_log
  ORDER BY created_at DESC
  LIMIT 5
`);
console.log(`\n📋 RECENT ACTIVITY`);
if (recentLogs.length === 0) {
  console.log('   No activity yet');
} else {
  recentLogs.forEach(log => {
    const time = new Date(log.created_at).toLocaleString();
    console.log(`   [${time}] ${log.action}`);
  });
}

console.log('\n' + '═'.repeat(50));
db.close();
