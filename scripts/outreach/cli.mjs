#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  freshState,
  importLeads,
  plan,
  approve,
  revise,
  stop,
  recordRevenue,
  report,
  digest,
  tick,
  audit,
  excludeEmails,
  refreshEvidence,
} from './engine.mjs';
import { openStore } from './store.mjs';
import { Gmail } from './gmail.mjs';
import { syncExistingAccounts } from './exclusions.mjs';
import { researchSources } from './research.mjs';

const HELP = `WalletLink outreach (Node 22.13+)

Set OUTREACH_DATA_DIR for a private data directory. Default: ~/.local/share/walletlink-outreach

init config.json              Initialize a paused workspace
research sources.json         Inspect up to 20 selected public company/contact pages
import prospects.json         Validate and deduplicate researched business prospects
exclude emails.json           Suppress existing customers, opt-outs or other contacts
sync-existing                 Refresh exclusions from existing WalletLink accounts
plan                          Score prospects and draft qualified sequences
list                          Show prospect IDs, scores and status
review                        Write private review.md and editable sequence JSON files
revise ID messages.json       Replace copy and invalidate approval
refresh ID prospect.json      Refresh evidence for an uncontacted prospect
approve ID SHA256             Approve the exact reviewed sequence
pause | resume                Control the sender; resuming sends nothing itself
doctor                        Verify the receiving mailbox and sending alias (read-only)
tick                          Preview due messages, with no network access
tick --send                   Check replies and send at most one approved message
stop ID REASON                replied, unsubscribed, bounced, won, or lost
revenue ID PAYMENT_ID CENTS    Record collected USD revenue, once per payment reference
report                        Print aggregate campaign results

Every initial message requires approval. Follow-ups run 4 and 7 days after
the preceding send, within weekday 09:00–17:00 sender-local hours.
`;

const [command, ...args] = process.argv.slice(2);
if (!command || command === 'help' || command === '--help') {
  console.log(HELP);
} else {
  let store;
  try {
    process.umask(0o077);
    const directory = resolve(
      process.env.OUTREACH_DATA_DIR ||
        join(homedir(), '.local/share/walletlink-outreach')
    );
    store = openStore(directory);
    let state = store.load();
    const now = Date.now();
    const jsonFile = (filename) => {
      if (!filename) throw new Error('A JSON file is required');
      return JSON.parse(readFileSync(filename, 'utf8'));
    };
    const output = (value) => console.log(JSON.stringify(value, null, 2));
    if (command === 'init') {
      if (state) throw new Error('Workspace already initialized');
      state = freshState(jsonFile(args[0]));
      store.save(state);
      output({ initialized: true, paused: true });
    } else {
      if (!state) throw new Error('Run init with a config file first');
      switch (command) {
        case 'research': {
          const findings = await researchSources(jsonFile(args[0]));
          const filename = join(directory, 'research.json');
          writeFileSync(filename, JSON.stringify(findings, null, 2), {
            mode: 0o600,
          });
          output({
            research: filename,
            inspected: findings.length,
            failed: findings.filter((item) => item.status === 'research-failed')
              .length,
          });
          break;
        }
        case 'import':
          output(importLeads(state, jsonFile(args[0]), now));
          break;
        case 'exclude':
          excludeEmails(state, jsonFile(args[0]), now);
          output({ excluded: state.exclusions.length });
          break;
        case 'sync-existing':
          output(await syncExistingAccounts(state, now));
          break;
        case 'plan':
          output({ drafted: plan(state, now) });
          break;
        case 'list':
          output(
            state.leads.map(({ id, company, score, status }) => ({
              id,
              company,
              score,
              status,
            }))
          );
          break;
        case 'review': {
          const lines = [
            '# Outreach review',
            '',
            'Review the business contact source, factual observation, initial message and two follow-ups. Approval authorizes this exact sequence. A reply stops all follow-ups.',
            '',
          ];
          for (const lead of state.leads.filter((l) => l.status === 'review')) {
            const hash = digest(lead);
            const editFile = join(directory, `${lead.id}.json`);
            writeFileSync(
              editFile,
              JSON.stringify(
                lead.messages.map(({ subject, body }) => ({ subject, body })),
                null,
                2
              ),
              { mode: 0o600 }
            );
            lines.push(
              `## ${lead.company}`,
              '',
              `Prospect: ${lead.id}`,
              `Recipient: ${lead.email}`,
              `Score: ${lead.score}`,
              `Evidence: ${lead.sourceUrl}`,
              `Published contact: ${lead.contactSourceUrl}`,
              `Observed: ${new Date(lead.observedAt).toISOString()}`,
              '',
              `Observation: ${lead.observation}`,
              ''
            );
            for (const [i, message] of lead.messages.entries())
              lines.push(
                `### Message ${i + 1}`,
                '',
                `From: ${message.senderName || ''} <${message.from}>`,
                `Subject: ${message.subject}`,
                '',
                message.body,
                ''
              );
            lines.push(
              'Approve after review:',
              '',
              '```sh',
              `npm run outreach -- approve ${lead.id} ${hash}`,
              '```',
              '',
              `Edit copy in ${editFile}, then run revise and review again.`,
              ''
            );
          }
          const filename = join(directory, 'review.md');
          writeFileSync(filename, lines.join('\n'), { mode: 0o600 });
          output({ review: filename });
          break;
        }
        case 'refresh':
          refreshEvidence(state, args[0], jsonFile(args[1]), now);
          output({ refreshed: args[0] });
          break;
        case 'revise':
          revise(state, args[0], jsonFile(args[1]), now);
          output({ revised: args[0] });
          break;
        case 'approve':
          approve(state, args[0], args[1], now);
          output({ approved: args[0] });
          break;
        case 'stop':
          stop(state, args[0], args[1], now);
          output({ stopped: args[0] });
          break;
        case 'revenue':
          recordRevenue(state, args[0], args[1], Number(args[2]), now);
          output({ recorded: args[1] });
          break;
        case 'pause':
        case 'resume':
          state.paused = command === 'pause';
          audit(state, command, {}, now);
          output({ paused: state.paused });
          break;
        case 'doctor': {
          const provider = new Gmail(state.config);
          output({
            verifiedSender: await provider.profile(),
            receivingMailbox: state.config.mailbox,
            paused: state.paused,
          });
          break;
        }
        case 'tick':
          if (args.length && (args.length !== 1 || args[0] !== '--send'))
            throw new Error('Use tick or tick --send');
          if (args[0] === '--send' && !state.paused) {
            await syncExistingAccounts(state, now);
            store.save(state);
          }
          output(
            await tick(
              state,
              new Gmail(state.config),
              (updated) => store.save(updated),
              { now, live: args[0] === '--send' }
            )
          );
          break;
        case 'report':
          output(report(state));
          break;
        default:
          throw new Error('Unknown command. Run outreach help.');
      }
      store.save(state);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    store?.close();
  }
}
