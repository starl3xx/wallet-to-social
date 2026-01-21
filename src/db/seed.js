import initSqlJs from 'sql.js';
import { readFileSync, writeFileSync } from 'fs';

const DB_PATH = './data/content.db';

const SQL = await initSqlJs();
const fileBuffer = readFileSync(DB_PATH);
const db = new SQL.Database(fileBuffer);

// Clear existing data (in reverse order of dependencies)
const tables = [
  'agent_log', 'published', 'critique_results', 'drafts', 'content_plan',
  'content_ideas', 'research_briefs', 'content_patterns', 'voice_profile',
  'communications', 'research', 'trends', 'competitor_content', 'founder_content'
];
tables.forEach(t => {
  try { db.run(`DELETE FROM ${t}`); } catch (e) { /* table may not exist */ }
});

// ===========================================
// FOUNDER CONTENT (for voice analysis)
// ===========================================
const founderContent = [
  {
    source: 'twitter',
    title: 'Thread on wallet identity',
    content: `Hot take: Wallets are the new social profiles.

Every NFT purchase, every DeFi interaction, every DAO vote - it's all public.

But here's the problem: 0x addresses are impossible to work with.

You've got a list of 10,000 token holders. Now what?

You can't email 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D.

But you CAN find their Twitter. Their Farcaster. Their ENS.

We built wallet-to-social to solve exactly this.

Upload your CSV. Get back social profiles. That simple.`,
    url: 'https://twitter.com/example/thread',
    engagement: 1240
  },
  {
    source: 'blog',
    title: 'Why We Built Wallet-to-Social',
    content: `Every token project has the same problem: they know their holders' wallets but not their identities.

You've got 15,000 addresses holding your token. You want to build community. You want to reward your most engaged holders. You want to reach out to whales.

But 0x7a250... doesn't have a DM inbox.

The data is there - ENS names, Twitter handles in text records, Farcaster profiles, Lens handles. It's just scattered across a dozen APIs and chains.

We aggregate all of it. One CSV in. Social profiles out.

The results speak for themselves:
- Average match rate: 22% (vs ~2.5% industry average)
- Processing: 10K wallets in under 2 minutes
- Sources: ENS, Web3.bio, Neynar, on-chain text records

This isn't just a lookup tool. It's the foundation for genuine community building in Web3.`,
    url: 'https://example.com/blog/why-we-built',
    engagement: 890
  },
  {
    source: 'linkedin',
    title: 'The wallet identity problem',
    content: `I've talked to 50+ token projects in the last 6 months.

Every single one has the same pain point:

"We have thousands of holders but we can't reach them."

Wallets are pseudonymous by design. That's a feature.

But when you're trying to build a community, reward loyal holders, or just say thank you to your biggest supporters - pseudonymity becomes a barrier.

The solution isn't to de-anonymize people. It's to find the ones who've already chosen to link their identity.

ENS text records. Farcaster verified addresses. Twitter handles in profiles.

These are people who WANT to be found.

wallet-to-social finds them for you.`,
    url: 'https://linkedin.com/posts/example',
    engagement: 560
  }
];

founderContent.forEach(c => {
  db.run(
    `INSERT INTO founder_content (source, title, content, url, engagement_score, analyzed) VALUES (?, ?, ?, ?, ?, FALSE)`,
    [c.source, c.title, c.content, c.url, c.engagement]
  );
});

// ===========================================
// VOICE PROFILE (for wallet-to-social)
// ===========================================
db.run(`
  INSERT INTO voice_profile (
    profile_name, tone, formality, sentence_patterns, paragraph_style,
    signature_phrases, hook_patterns, data_usage_style, storytelling_style,
    cta_style, controversial_tendency, emoji_usage, vocabulary_notes, avoid_patterns
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`, [
  'wallet-to-social',
  'Direct, technical but accessible, Web3-native',
  'Casual professional - speaks to builders, not suits',
  JSON.stringify([
    'Short punchy sentences for emphasis',
    'Specific numbers and percentages',
    'Problem → Solution structure',
    'Rhetorical questions that resonate with audience pain'
  ]),
  'Short paragraphs, lots of whitespace, easy to scan',
  JSON.stringify([
    'Here\'s the problem',
    'The data is there',
    'It\'s that simple',
    'The results speak for themselves',
    '0x addresses are impossible to work with'
  ]),
  JSON.stringify([
    'Specific pain point that resonates',
    'Concrete numbers (10K wallets, 22% match rate)',
    'Direct challenge: "Now what?"',
    'Web3-native terminology'
  ]),
  'Always leads with specific metrics. 22%, 10K, 9x - concrete over vague',
  'User problems and real use cases. DAOs, token projects, NFT communities.',
  'Direct and action-oriented. "Upload your CSV. Get back social profiles."',
  'Medium - takes positions on Web3 identity but not inflammatory',
  'Minimal - occasionally for Web3 context but mostly text-focused',
  JSON.stringify([
    'Web3-native terms: wallets, holders, ENS, Farcaster',
    'Action verbs: upload, resolve, match, reach',
    'Specific over general: "10K wallets" not "lots of wallets"'
  ]),
  JSON.stringify([
    '"Web3 is the future of..."',
    '"Revolutionizing..."',
    'Generic blockchain hype',
    'Over-explaining what wallets are',
    'Buzzwords without substance'
  ])
]);

// ===========================================
// COMPETITOR CONTENT (for gap analysis)
// ===========================================
const competitors = [
  {
    name: 'Arkham Intelligence',
    title: 'Blockchain Analytics Platform',
    url: 'https://arkhamintelligence.com',
    summary: 'Enterprise blockchain analytics with entity identification. Expensive, complex, focused on investigation/compliance.',
    angle: 'Intelligence and investigation angle - serious, corporate',
    engagement: 'High awareness but seen as enterprise-only',
    gap: 'Too complex for simple "who are my holders" use case. Opportunity: Simple, self-serve, community-building focused.'
  },
  {
    name: 'Etherscan Labels',
    title: 'Free address labels',
    url: 'https://etherscan.io/labelcloud',
    summary: 'Free but very limited. Only labels major addresses (exchanges, contracts). No social profiles.',
    angle: 'Free utility tool',
    engagement: 'Everyone uses Etherscan but labels are limited',
    gap: 'No social profiles, no bulk processing. Opportunity: Comprehensive social resolution at scale.'
  },
  {
    name: 'Nansen',
    title: 'Wallet Labels & Smart Money',
    url: 'https://nansen.ai',
    summary: 'Great for tracking smart money and wallet categories. Enterprise pricing. Focus on trading/DeFi analytics.',
    angle: 'Smart money and trading signals',
    engagement: 'Popular with traders and funds',
    gap: 'Expensive, focused on trading not community. Opportunity: Accessible pricing, community-building use cases.'
  }
];

competitors.forEach(c => {
  db.run(
    `INSERT INTO competitor_content (competitor_name, title, url, summary, angle, engagement_notes, gap_opportunity) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [c.name, c.title, c.url, c.summary, c.angle, c.engagement, c.gap]
  );
});

// ===========================================
// TRENDS (Web3/Crypto space)
// ===========================================
const trends = [
  {
    topic: 'Farcaster Growth Explosion',
    description: 'Farcaster daily active users up 10x in 2024. Frames driving viral adoption. Becoming the "crypto Twitter" for builders.',
    source: 'Dune Analytics, Farcaster stats',
    relevance: 95,
    data: JSON.stringify([
      'Farcaster DAU: 50K → 400K+ in 2024',
      'Frames launched Jan 2024, 1M+ interactions in first week',
      '80% of active crypto builders now on Farcaster',
      'Verified wallet addresses make identity resolution trivial'
    ])
  },
  {
    topic: 'Token-Gated Communities Maturing',
    description: 'Moving beyond "hold NFT to access Discord." Projects building sophisticated holder engagement, rewards, and governance.',
    source: 'a]Crypto Twitter discourse, Guild.xyz growth',
    relevance: 90,
    data: JSON.stringify([
      'Guild.xyz: 2M+ users, 30K+ communities',
      'Token-gated perks driving 40% higher retention',
      'Projects allocating 5-10% of tokens to community rewards',
      'Problem: hard to reward holders without knowing who they are'
    ])
  },
  {
    topic: 'ENS as Identity Standard',
    description: 'ENS becoming the de facto identity layer for Web3. Text records storing Twitter, email, and other socials.',
    source: 'ENS Labs, Dune dashboards',
    relevance: 88,
    data: JSON.stringify([
      '2M+ ENS names registered',
      '40% of ENS holders have text records set',
      'Twitter verification via ENS gaining traction',
      'ENS avatars now rendering across major platforms'
    ])
  },
  {
    topic: 'Airdrop Fatigue → Quality Targeting',
    description: 'Projects moving away from broad airdrops. Focus on quality distribution to engaged users, not farmers.',
    source: 'Airdrop postmortems, Twitter discourse',
    relevance: 85,
    data: JSON.stringify([
      'LayerZero Sybil filtering: 800K addresses flagged',
      'Projects now requiring "social proof" for eligibility',
      'Quality > quantity: smaller, targeted airdrops performing better',
      'Need: identify genuine community members vs farmers'
    ])
  }
];

trends.forEach(t => {
  db.run(
    `INSERT INTO trends (topic, description, source, relevance_score, data_points, status) VALUES (?, ?, ?, ?, ?, 'active')`,
    [t.topic, t.description, t.source, t.relevance, t.data]
  );
});

// ===========================================
// RESEARCH (Web3 identity & community)
// ===========================================
const research = [
  {
    title: 'Wallet-to-Social Match Rate Benchmarks',
    summary: 'Analysis of 500K+ wallet addresses across different token communities to establish match rate benchmarks',
    findings: JSON.stringify([
      'Average match rate across all wallets: ~2.5%',
      'NFT communities: 15-25% match rate (higher social presence)',
      'DeFi-heavy wallets: 5-10% match rate',
      'DAO governance participants: 30-40% match rate (most engaged)',
      'Farcaster as source: 3x more matches than ENS alone'
    ]),
    data: JSON.stringify([
      { metric: 'Overall average match rate', value: '2.5%' },
      { metric: 'NFT community match rate', value: '15-25%' },
      { metric: 'DAO participant match rate', value: '30-40%' },
      { metric: 'wallet-to-social match rate', value: '22%' },
      { metric: 'Improvement vs average', value: '9x' }
    ]),
    sources: JSON.stringify(['Internal analysis', 'Dune Analytics', 'Neynar API data']),
    category: 'benchmarks',
    credibility: 90
  },
  {
    title: 'Community Engagement: Known vs Anonymous Holders',
    summary: 'Study on how communities with identified members differ from those with purely anonymous holders',
    findings: JSON.stringify([
      'Communities with 20%+ identified members: 3x more Discord engagement',
      'Identified holders 5x more likely to participate in governance',
      'Direct outreach to known holders: 35% response rate vs 2% broadcast',
      'Holder retention 40% higher when personal connection established',
      'Top 10% of social-linked holders drive 60% of organic mentions'
    ]),
    data: JSON.stringify([
      { metric: 'Discord engagement lift', value: '3x' },
      { metric: 'Governance participation', value: '5x' },
      { metric: 'Direct outreach response rate', value: '35%' },
      { metric: 'Retention improvement', value: '40%' }
    ]),
    sources: JSON.stringify(['Token project interviews', 'Discord analytics', 'Snapshot data']),
    category: 'community_engagement',
    credibility: 85
  },
  {
    title: 'Priority Score: Holdings × Social Reach',
    summary: 'How combining token holdings with social follower count creates better holder prioritization',
    findings: JSON.stringify([
      'High holdings + high reach: Ideal brand ambassadors (top 1%)',
      'High holdings + low reach: Whales to nurture privately',
      'Low holdings + high reach: Influencers to convert',
      'Priority score formula: holdings × log₁₀(followers + 1)',
      'Top 50 by priority score drove 70% of a projects organic reach'
    ]),
    data: JSON.stringify([
      { metric: 'Top priority holders organic reach contribution', value: '70%' },
      { metric: 'Average whale with low reach', value: '$50K holdings, 200 followers' },
      { metric: 'Average influencer with low holdings', value: '$500 holdings, 50K followers' }
    ]),
    sources: JSON.stringify(['Internal modeling', 'Project case studies']),
    category: 'prioritization',
    credibility: 88
  }
];

research.forEach(r => {
  db.run(
    `INSERT INTO research (title, summary, key_findings, data_points, sources, category, credibility_score, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
    [r.title, r.summary, r.findings, r.data, r.sources, r.category, r.credibility]
  );
});

// ===========================================
// COMMUNICATIONS (wallet-to-social updates)
// ===========================================
const communications = [
  {
    type: 'product_update',
    title: 'Launch: Farcaster Integration with Follower Counts',
    details: 'Added Neynar API integration for Farcaster lookups. Now returns Farcaster usernames, follower counts, and verified Twitter handles. Major accuracy improvement.',
    messages: JSON.stringify([
      'Farcaster profiles now included in results',
      'See follower counts to prioritize outreach',
      'Verified Twitter handles from Farcaster (more reliable than ENS)',
      '3x more matches with Farcaster data source'
    ]),
    audience: 'Existing users, Farcaster-native projects, crypto Twitter',
    priority: 1
  },
  {
    type: 'case_study',
    title: 'How [DAO Name] Increased Governance Participation 4x',
    details: 'DAO used wallet-to-social to identify their most engaged holders with social presence. Direct outreach to top 200 holders resulted in 4x governance participation.',
    messages: JSON.stringify([
      'Identified 200 high-value holders with social presence',
      'Direct Twitter/Farcaster outreach: 40% response rate',
      'Governance participation increased from 5% to 22%',
      'Created holder ambassador program from top matches'
    ]),
    audience: 'DAOs, governance-focused projects, token communities',
    priority: 2
  },
  {
    type: 'feature',
    title: 'Priority Score: Rank Holders by Holdings × Social Reach',
    details: 'New priority scoring system that combines token holdings with social follower count. Helps identify your most valuable community members.',
    messages: JSON.stringify([
      'Priority Score = Holdings × log₁₀(Followers + 1)',
      'Surface your whales with reach, not just your whales',
      'Export sorted by priority for targeted outreach',
      'Works with any ERC-20 token holdings data'
    ]),
    audience: 'Token projects, marketing teams, community managers',
    priority: 2
  },
  {
    type: 'announcement',
    title: 'Now Processing 10K+ Wallets in Under 2 Minutes',
    details: 'Backend optimizations for handling large datasets. Streaming progress updates. Concurrent API calls. 24-hour caching.',
    messages: JSON.stringify([
      '10,000 wallets processed in under 2 minutes',
      'Real-time progress streaming while you wait',
      '24-hour caching: instant results on repeat lookups',
      'No more timeouts on large holder lists'
    ]),
    audience: 'Large token projects, NFT collections with 10K+ holders',
    priority: 3
  }
];

communications.forEach(c => {
  db.run(
    `INSERT INTO communications (type, title, details, key_messages, target_audience, priority, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [c.type, c.title, c.details, c.messages, c.audience, c.priority]
  );
});

// ===========================================
// CONTENT PATTERNS (Web3 audience)
// ===========================================
const patterns = [
  {
    type: 'hook',
    description: 'Problem statement that every token project relates to',
    example: '"You\'ve got 15,000 wallet addresses. Now what?"',
    score: 94
  },
  {
    type: 'hook',
    description: 'Specific pain point with 0x addresses',
    example: '"You can\'t DM 0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D"',
    score: 91
  },
  {
    type: 'hook',
    description: 'Concrete metric that shows value',
    example: '"22% match rate vs 2.5% industry average. That\'s 9x more identified holders."',
    score: 89
  },
  {
    type: 'structure',
    description: 'Problem → Data exists → Solution → Results',
    example: 'Show the pain, prove data is available, explain aggregation, share metrics',
    score: 87
  },
  {
    type: 'angle',
    description: 'Community building, not surveillance',
    example: 'Finding people who WANT to be found, not de-anonymizing',
    score: 92
  },
  {
    type: 'cta',
    description: 'Simple, action-oriented, removes friction',
    example: '"Upload your CSV. Get back social profiles. That simple."',
    score: 90
  }
];

patterns.forEach(p => {
  db.run(
    `INSERT INTO content_patterns (pattern_type, description, example, effectiveness_score) VALUES (?, ?, ?, ?)`,
    [p.type, p.description, p.example, p.score]
  );
});

// Log seeding
db.run(`INSERT INTO agent_log (phase, action, details) VALUES (?, ?, ?)`, [
  'discover',
  'database_seeded',
  JSON.stringify({
    project: 'wallet-to-social',
    founder_content: founderContent.length,
    competitors: competitors.length,
    trends: trends.length,
    research: research.length,
    communications: communications.length,
    patterns: patterns.length
  })
]);

// Save to file
const data = db.export();
const buffer = Buffer.from(data);
writeFileSync(DB_PATH, buffer);

console.log('✅ Database seeded with wallet-to-social content:');
console.log(`   - ${founderContent.length} founder content pieces (for voice analysis)`);
console.log(`   - 1 wallet-to-social voice profile`);
console.log(`   - ${competitors.length} competitor analyses (Arkham, Etherscan, Nansen)`);
console.log(`   - ${trends.length} Web3 trends (Farcaster, token-gating, ENS, airdrops)`);
console.log(`   - ${research.length} research studies (match rates, engagement, priority scoring)`);
console.log(`   - ${communications.length} product communications`);
console.log(`   - ${patterns.length} content patterns for Web3 audience`);

db.close();
