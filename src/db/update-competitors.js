import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Clear existing competitors
db.run('DELETE FROM competitor_content');

// Add real competitors
const competitors = [
  {
    name: 'Addressable',
    title: 'Web3 CRM & Wallet Marketing',
    url: 'https://addressable.io',
    summary: 'Web3 CRM platform focused on wallet-based marketing automation. Enterprise-focused with complex onboarding.',
    angle: 'Full CRM suite approach - marketing automation, campaigns, analytics',
    engagement: 'Popular with larger projects, seen as enterprise solution',
    gap: 'Overkill for simple "who are my holders" use case. Complex setup. Opportunity: Simple, instant results, no onboarding friction.'
  },
  {
    name: 'Blaze',
    title: 'Web3 Growth & Community Platform',
    url: 'https://blaze.xyz',
    summary: 'Growth platform with wallet enrichment, community tools, and campaign management. Subscription-based.',
    angle: 'All-in-one growth platform - enrichment is one feature of many',
    engagement: 'Growing adoption, especially for NFT projects',
    gap: 'Bundled with features you may not need. Monthly commitment. Opportunity: Pay for what you use, focused on the core problem.'
  },
  {
    name: 'Holder.xyz',
    title: 'Token Holder Analytics',
    url: 'https://holder.xyz',
    summary: 'Analytics platform for understanding token holder composition. Focus on holder segmentation and trends.',
    angle: 'Analytics-first - understanding WHO holds, not reaching them',
    engagement: 'Used for holder analysis and investor reporting',
    gap: 'Analysis focus, not action focus. Shows you who holders are categorically, not individually. Opportunity: Actionable social profiles for outreach.'
  }
];

competitors.forEach(c => {
  db.run(
    `INSERT INTO competitor_content (competitor_name, title, url, summary, angle, engagement_notes, gap_opportunity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [c.name, c.title, c.url, c.summary, c.angle, c.engagement, c.gap]
  );
});

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ Competitors updated:');
competitors.forEach(c => console.log(`   - ${c.name}: ${c.title}`));

db.close();
