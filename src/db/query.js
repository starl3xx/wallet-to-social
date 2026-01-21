/**
 * Database query utilities for Ralph the Copywriter
 * Usage: node src/db/query.js <command> [args]
 *
 * Commands:
 *   trends [active|used|all]     - List trends
 *   research [available|used]    - List research
 *   comms [pending|assigned]     - List communications
 *   plan [status]                - List content plan
 *   drafts [plan_id]             - List drafts
 *   published                    - List published content
 */

import initSqlJs from 'sql.js';
import { readFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

const command = process.argv[2];
const arg = process.argv[3];

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  return results;
}

function printTable(rows, title) {
  console.log(`\n${title}`);
  console.log('─'.repeat(60));
  if (rows.length === 0) {
    console.log('No results');
    return;
  }
  rows.forEach((row, i) => {
    console.log(`\n[${i + 1}] ID: ${row.id}`);
    Object.entries(row).forEach(([key, value]) => {
      if (key !== 'id') {
        // Truncate long values
        const display = String(value).length > 100
          ? String(value).substring(0, 100) + '...'
          : value;
        console.log(`    ${key}: ${display}`);
      }
    });
  });
}

switch (command) {
  case 'trends': {
    const status = arg || 'active';
    const rows = status === 'all'
      ? getAll('SELECT * FROM trends ORDER BY relevance_score DESC')
      : getAll('SELECT * FROM trends WHERE status = ? ORDER BY relevance_score DESC', [status]);
    printTable(rows, `🔥 TRENDS (${status})`);
    break;
  }

  case 'research': {
    const status = arg || 'available';
    const rows = getAll('SELECT id, title, summary, category, status FROM research WHERE status = ?', [status]);
    printTable(rows, `🔬 RESEARCH (${status})`);
    break;
  }

  case 'comms': {
    const status = arg || 'pending';
    const rows = getAll('SELECT id, type, title, priority, target_audience, status FROM communications WHERE status = ? ORDER BY priority', [status]);
    printTable(rows, `📢 COMMUNICATIONS (${status})`);
    break;
  }

  case 'plan': {
    const status = arg;
    const rows = status
      ? getAll('SELECT * FROM content_plan WHERE status = ? ORDER BY priority', [status])
      : getAll('SELECT * FROM content_plan ORDER BY status, priority');
    printTable(rows, `📝 CONTENT PLAN${status ? ` (${status})` : ''}`);
    break;
  }

  case 'drafts': {
    const planId = arg;
    const rows = planId
      ? getAll(`SELECT d.*, cp.title as plan_title FROM drafts d
         JOIN content_plan cp ON d.plan_id = cp.id
         WHERE d.plan_id = ? ORDER BY d.version DESC`, [planId])
      : getAll(`SELECT d.*, cp.title as plan_title FROM drafts d
         JOIN content_plan cp ON d.plan_id = cp.id
         ORDER BY d.updated_at DESC`);
    printTable(rows, `✏️  DRAFTS${planId ? ` (plan ${planId})` : ''}`);
    break;
  }

  case 'published': {
    const rows = getAll(`
      SELECT p.id, cp.title, p.meta_description, p.published_at
      FROM published p
      JOIN content_plan cp ON p.plan_id = cp.id
      ORDER BY p.published_at DESC
    `);
    printTable(rows, '✅ PUBLISHED CONTENT');
    break;
  }

  default:
    console.log(`
📚 Database Query Tool

Usage: node src/db/query.js <command> [args]

Commands:
  trends [active|used|all]     List trends
  research [available|used]    List research items
  comms [pending|assigned]     List communications
  plan [status]                List content plan items
  drafts [plan_id]             List drafts
  published                    List published content

Examples:
  node src/db/query.js trends active
  node src/db/query.js comms pending
  node src/db/query.js plan writing
`);
}

db.close();
