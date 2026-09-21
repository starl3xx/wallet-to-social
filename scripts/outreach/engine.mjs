import { createHash, randomUUID } from 'node:crypto';

const DAY = 86_400_000;
export const TERMINAL = new Set([
  'replied',
  'unsubscribed',
  'bounced',
  'won',
  'lost',
  'excluded',
]);
const SEGMENTS = { agency: 30, campaign: 25, developer: 20, researcher: 10 };

function text(value, name, max = 1000) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error(`Invalid ${name}`);
  }
  return value.trim();
}

export function email(value) {
  const normalized = text(value, 'email', 254).toLowerCase();
  if (
    !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(
      normalized
    )
  ) {
    throw new Error('Invalid email');
  }
  return normalized;
}

function url(value, name) {
  const parsed = new URL(text(value, name, 2048));
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password)
    throw new Error(`Invalid ${name}`);
  return parsed.href;
}

export function validateConfig(input) {
  const config = {
    sender: email(input.sender),
    mailbox: email(input.mailbox || input.sender),
    senderName: text(input.senderName, 'sender name', 100),
    signature: text(input.signature, 'signature', 500),
    timezone: text(input.timezone || 'America/Chicago', 'timezone', 100),
    dailyLimit: input.dailyLimit ?? 5,
    minGapMinutes: input.minGapMinutes ?? 15,
  };
  new Intl.DateTimeFormat('en-US', { timeZone: config.timezone }).format();
  if (
    !Number.isInteger(config.dailyLimit) ||
    config.dailyLimit < 1 ||
    config.dailyLimit > 25
  )
    throw new Error('Daily limit must be 1 through 25');
  if (!Number.isInteger(config.minGapMinutes) || config.minGapMinutes < 5)
    throw new Error('Minimum gap must be at least 5 minutes');
  return config;
}

export function freshState(config) {
  return {
    version: 1,
    config: validateConfig(config),
    paused: true,
    leads: [],
    events: [],
    receipts: [],
    exclusions: [],
  };
}

export function excludeEmails(state, addresses, now) {
  if (!Array.isArray(addresses))
    throw new Error('Exclusions must be an array of email addresses');
  const validated = addresses.map(email);
  for (const address of validated) {
    if (!state.exclusions.includes(address)) state.exclusions.push(address);
    const lead = state.leads.find((l) => l.email === address);
    if (lead) stop(state, lead.id, 'excluded', now);
  }
  audit(state, 'exclusions-imported', { count: validated.length }, now);
}

export function audit(state, type, details, now) {
  state.events.push({ id: randomUUID(), type, at: now, ...details });
}

export function importLeads(state, rows, now) {
  if (!Array.isArray(rows) || rows.length > 500)
    throw new Error('Import must contain at most 500 prospects');
  // Validate the entire batch before changing anything.
  const validated = rows.map((row) => {
    if (!Object.hasOwn(SEGMENTS, row.segment))
      throw new Error('Unknown segment');
    for (const key of ['hasWalletAudience', 'nearTermProject', 'budgetOwner']) {
      if (typeof row[key] !== 'boolean')
        throw new Error(`Missing boolean: ${key}`);
    }
    const observedAt = Date.parse(row.observedAt);
    if (
      !Number.isFinite(observedAt) ||
      observedAt > now ||
      now - observedAt > 30 * DAY
    )
      throw new Error(
        'Prospect evidence must be dated within the last 30 days'
      );
    return {
      email: email(row.email),
      name: text(row.name, 'contact name', 100),
      company: text(row.company, 'company', 150),
      segment: row.segment,
      sourceUrl: url(row.sourceUrl, 'source URL'),
      contactSourceUrl: url(
        row.contactSourceUrl,
        'published business contact URL'
      ),
      observation: text(row.observation, 'factual observation', 700),
      observedAt,
      hasWalletAudience: row.hasWalletAudience,
      nearTermProject: row.nearTermProject,
      budgetOwner: row.budgetOwner,
      campaign: text(row.campaign, 'campaign', 80),
    };
  });
  let inserted = 0;
  for (const row of validated) {
    // Never overwrite approvals, prior replies, or opt-outs on reimport.
    if (
      state.exclusions.includes(row.email) ||
      state.leads.some((lead) => lead.email === row.email)
    )
      continue;
    const score =
      SEGMENTS[row.segment] +
      (row.hasWalletAudience ? 30 : 0) +
      (row.nearTermProject ? 25 : 0) +
      (row.budgetOwner ? 15 : 0);
    const lead = {
      ...row,
      id: randomUUID(),
      score,
      status: 'new',
      messages: [],
      approval: null,
      createdAt: now,
    };
    state.leads.push(lead);
    audit(state, 'imported', { leadId: lead.id }, now);
    inserted++;
  }
  return { inserted, skipped: rows.length - inserted };
}

export function getLead(state, id) {
  const lead = state.leads.find((item) => item.id === id);
  if (!lead) throw new Error('Unknown prospect');
  return lead;
}

export function digest(lead) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        email: lead.email,
        sourceUrl: lead.sourceUrl,
        contactSourceUrl: lead.contactSourceUrl,
        observation: lead.observation,
        messages: lead.messages.map(
          ({ subject, body, from, senderName, delayDays }) => ({
            subject,
            body,
            from,
            senderName,
            delayDays,
          })
        ),
      })
    )
    .digest('hex');
}

export function plan(state, now) {
  let count = 0;
  for (const lead of state.leads) {
    if (
      lead.status !== 'new' ||
      lead.score < 70 ||
      !lead.hasWalletAudience ||
      now - lead.observedAt > 30 * DAY
    )
      continue;
    const link = new URL('https://walletlink.social/');
    link.searchParams.set('utm_source', 'outreach');
    link.searchParams.set('utm_medium', 'email');
    link.searchParams.set('utm_campaign', lead.campaign);
    // The URL deliberately contains no recipient or prospect identifier.
    const question =
      lead.segment === 'agency'
        ? 'Does that come up in your client work?'
        : lead.segment === 'developer'
          ? 'Would that be useful in what you’re building?'
          : 'Is that something you’d use when looking into your audience?';
    const footer = `\n\n${state.config.senderName}\n${state.config.signature}\n\nNot relevant? Just say so and I won't follow up.`;
    const subject = 'wallets → socials';
    const bodies = [
      `Hey ${lead.name},\n\n${lead.observation}\n\nI built walletlink for looking up the X and Farcaster accounts linked to EVM wallets. Drop in a wallet list and it checks for matches.\n\n${question}\n\n${link.href}${footer}`,
      `Hey ${lead.name},\n\nJust following up on this. Curious whether looking up the socials behind a wallet list is something you already do, or haven't had a reason to try.\n\n${question}${footer}`,
      `I'll leave it here. If a wallet list turns up and you want to try it, it's at ${link.href}\n\n${state.config.senderName}\n${state.config.signature}\n\nNo more follow-ups from me.`,
    ];
    lead.messages = bodies.map((body, index) => ({
      id: randomUUID(),
      from: state.config.sender,
      senderName: state.config.senderName,
      subject,
      body,
      delayDays: [0, 4, 7][index],
      status: 'draft',
      sentAt: null,
    }));
    lead.status = 'review';
    audit(state, 'planned', { leadId: lead.id }, now);
    count++;
  }
  return count;
}

export function approve(state, id, expectedDigest, now) {
  const lead = getLead(state, id);
  if (
    lead.status !== 'review' ||
    lead.messages.length !== 3 ||
    digest(lead) !== expectedDigest
  )
    throw new Error('Approval requires the current reviewed sequence hash');
  if (now - lead.observedAt > 30 * DAY)
    throw new Error('Refresh stale prospect evidence before approval');
  lead.approval = { digest: expectedDigest, at: now };
  lead.status = 'active';
  audit(state, 'approved', { leadId: id, digest: expectedDigest }, now);
}

export function revise(state, id, messages, now) {
  const lead = getLead(state, id);
  if (
    !['review', 'active'].includes(lead.status) ||
    lead.messages.some((m) => m.status !== 'draft')
  )
    throw new Error('Only unsent sequences can be edited');
  if (!Array.isArray(messages) || messages.length !== 3)
    throw new Error('Provide exactly three messages');
  const revised = messages.map((message, i) => {
    const subject = text(message.subject, 'subject', 200);
    if (
      typeof message.body !== 'string' ||
      !message.body.trim() ||
      message.body.length > 8000 ||
      /[\x00\x0b\x0c]/.test(message.body)
    )
      throw new Error('Invalid message body');
    return { ...lead.messages[i], subject, body: message.body };
  });
  if (revised.some((m) => m.subject !== revised[0].subject))
    throw new Error('All sequence subjects must match for reply threading');
  lead.messages = revised;
  lead.approval = null;
  lead.status = 'review';
  audit(state, 'revised', { leadId: id }, now);
}

export function refreshEvidence(state, id, input, now) {
  const lead = getLead(state, id);
  if (
    TERMINAL.has(lead.status) ||
    lead.messages.some((m) => m.status !== 'draft')
  )
    throw new Error(
      'Only uncontacted prospects can receive refreshed evidence'
    );
  const temporary = freshState(state.config);
  // Reuse full import validation, without changing the recipient or losing history.
  importLeads(temporary, [{ ...input, email: lead.email }], now);
  const refreshed = temporary.leads[0];
  Object.assign(lead, refreshed, { id, createdAt: lead.createdAt });
  audit(state, 'evidence-refreshed', { leadId: id }, now);
}

export function stop(state, id, status, now) {
  if (!TERMINAL.has(status)) throw new Error('Unknown stop reason');
  const lead = getLead(state, id);
  // Suppressions cannot be accidentally replaced by a sales-status update.
  if (['unsubscribed', 'bounced'].includes(lead.status)) return;
  lead.status = status;
  audit(state, status, { leadId: id }, now);
}

export function recordRevenue(state, id, externalId, cents, now) {
  getLead(state, id);
  text(externalId, 'payment reference', 200);
  if (!Number.isSafeInteger(cents) || cents <= 0)
    throw new Error('Revenue must be positive integer USD cents');
  const previous = state.receipts.find((r) => r.externalId === externalId);
  if (previous) {
    if (previous.leadId !== id || previous.cents !== cents)
      throw new Error(
        'Payment reference already recorded with different details'
      );
    return;
  }
  state.receipts.push({ leadId: id, externalId, cents, at: now });
  stop(state, id, 'won', now);
  audit(state, 'revenue', { leadId: id, externalId, cents }, now);
}

export function localClock(timestamp, timezone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(timestamp)
      .map(({ type, value }) => [type, value])
  );
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    weekday: parts.weekday,
  };
}

export function candidates(state, now) {
  return state.leads
    .filter(
      (lead) =>
        lead.status === 'active' && lead.approval?.digest === digest(lead)
    )
    .sort((a, b) => b.score - a.score)
    .flatMap((lead) => {
      const index = lead.messages.findIndex(
        (message) => message.status !== 'sent'
      );
      const message = lead.messages[index];
      if (!message || message.status !== 'draft') return [];
      if (index === 0 && now - lead.approval.at > 14 * DAY) return [];
      const dueAt =
        index === 0
          ? lead.approval.at
          : lead.messages[index - 1].sentAt + message.delayDays * DAY;
      return now >= dueAt ? [{ lead, message, index }] : [];
    });
}

/** Provider contract: profile, hasReply, send, findSent. No outbound call without live=true. */
export async function tick(
  state,
  provider,
  persist,
  { now = Date.now(), live = false } = {}
) {
  if (!live)
    return {
      mode: 'preview',
      paused: state.paused,
      due: candidates(state, now).map(({ lead, message, index }) => ({
        leadId: lead.id,
        messageId: message.id,
        step: index + 1,
      })),
    };
  if (state.paused) return { mode: 'paused' };
  if (email(await provider.profile()) !== state.config.sender)
    throw new Error('Connected mailbox does not match the configured sender');
  // A crash after submission leaves a sending record. Reconcile, never resend it.
  for (const lead of state.leads) {
    for (const message of lead.messages.filter((m) =>
      ['sending', 'uncertain'].includes(m.status)
    )) {
      const receipt = await provider.findSent(message.rfcId, { lead, message });
      if (receipt) {
        message.status = 'sent';
        message.sentAt = receipt.sentAt;
        message.providerId = receipt.id;
        message.threadId = receipt.threadId;
        message.providerRfcId = receipt.rfcId;
        audit(
          state,
          'reconciled',
          { leadId: lead.id, messageId: message.id },
          now
        );
        persist(state);
      }
    }
  }
  // Keep checking replies after the final follow-up as well.
  for (const lead of state.leads.filter(
    (l) => l.status === 'active' && l.messages.some((m) => m.status === 'sent')
  )) {
    if (await provider.hasReply(lead)) {
      stop(state, lead.id, 'replied', now);
      persist(state);
    }
  }
  if (
    state.leads.some((l) =>
      l.messages.some((m) => ['sending', 'uncertain'].includes(m.status))
    )
  )
    return {
      mode: 'blocked',
      reason: 'Uncertain delivery requires reconciliation',
    };
  const clock = localClock(now, state.config.timezone);
  if (
    ['Sat', 'Sun'].includes(clock.weekday) ||
    clock.hour < 9 ||
    clock.hour >= 17
  )
    return { mode: 'outside-hours' };
  const sent = state.leads
    .flatMap((l) => l.messages)
    .filter((m) => m.status === 'sent');
  if (
    sent.filter(
      (m) => localClock(m.sentAt, state.config.timezone).day === clock.day
    ).length >= state.config.dailyLimit
  )
    return { mode: 'daily-limit' };
  if (sent.some((m) => now - m.sentAt < state.config.minGapMinutes * 60_000))
    return { mode: 'spacing' };
  for (const { lead, message, index } of candidates(state, now)) {
    // Includes new threads from a recipient, not just replies in the original thread.
    if (await provider.hasReply(lead)) {
      stop(state, lead.id, 'replied', now);
      persist(state);
      continue;
    }
    message.rfcId = `<${message.id}@${state.config.sender.split('@')[1]}>`;
    message.deliveryId = message.id;
    message.status = 'sending';
    message.attemptedAt = now;
    audit(
      state,
      'send-attempted',
      { leadId: lead.id, messageId: message.id },
      now
    );
    persist(state);
    try {
      const receipt = await provider.send(lead, message, index);
      if (!receipt?.id || !receipt?.threadId)
        throw new Error('Missing delivery receipt');
      message.status = 'sent';
      message.sentAt = now;
      message.providerId = receipt.id;
      message.threadId = receipt.threadId;
      audit(state, 'sent', { leadId: lead.id, messageId: message.id }, now);
      persist(state);
      return { mode: 'sent', leadId: lead.id, messageId: message.id };
    } catch {
      message.status = 'uncertain';
      audit(
        state,
        'delivery-uncertain',
        { leadId: lead.id, messageId: message.id },
        now
      );
      persist(state);
      // Deliberately omit provider errors, which may contain private message data.
      throw new Error(
        'Delivery is uncertain. Sending is blocked until the mailbox is reconciled.'
      );
    }
  }
  return { mode: 'idle' };
}

export function report(state) {
  return [...new Set(state.leads.map((lead) => lead.campaign))].map(
    (campaign) => {
      const leads = state.leads.filter((lead) => lead.campaign === campaign);
      const receipts = state.receipts.filter((receipt) =>
        leads.some((lead) => lead.id === receipt.leadId)
      );
      return {
        campaign,
        prospects: leads.length,
        qualified: leads.filter((l) => l.score >= 70 && l.hasWalletAudience)
          .length,
        contacted: leads.filter((l) =>
          l.messages.some((m) => m.status === 'sent')
        ).length,
        replies: leads.filter((l) =>
          state.events.some((e) => e.leadId === l.id && e.type === 'replied')
        ).length,
        customers: new Set(receipts.map((r) => r.leadId)).size,
        purchases: receipts.length,
        revenueCents: receipts.reduce((sum, r) => sum + r.cents, 0),
      };
    }
  );
}
