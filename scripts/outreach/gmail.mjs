import { email } from './engine.mjs';

const ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const header = (message, name) =>
  message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )?.value;

export function mime(lead, message, index) {
  const previous = lead.messages[index - 1];
  const headers = [
    `From: ${message.from}`,
    `To: ${lead.email}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    `Message-ID: ${message.rfcId}`,
    `Reply-To: ${message.from}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ];
  if (previous?.rfcId) {
    headers.push(`In-Reply-To: ${previous.rfcId}`);
    headers.push(
      `References: ${lead.messages
        .slice(0, index)
        .map((m) => m.rfcId)
        .join(' ')}`
    );
  }
  const body =
    Buffer.from(message.body.replace(/\r?\n/g, '\r\n'))
      .toString('base64')
      .match(/.{1,76}/g)
      ?.join('\r\n') || '';
  return Buffer.from(`${headers.join('\r\n')}\r\n\r\n${body}\r\n`).toString(
    'base64url'
  );
}

export class Gmail {
  constructor(config, { fetcher = fetch, env = process.env } = {}) {
    this.config = config;
    this.fetcher = fetcher;
    this.env = env;
    this.token = null;
    this.aliases = [];
  }

  async request(path, options = {}) {
    if (!this.token) {
      const clientId = this.env.OUTREACH_GOOGLE_CLIENT_ID;
      const secret = this.env.OUTREACH_GOOGLE_CLIENT_SECRET;
      const refresh = this.env.OUTREACH_GOOGLE_REFRESH_TOKEN;
      if (!clientId || !secret || !refresh)
        throw new Error('Outreach Gmail OAuth credentials are not configured');
      const response = await this.fetcher(
        'https://oauth2.googleapis.com/token',
        {
          method: 'POST',
          signal: AbortSignal.timeout(15_000),
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: secret,
            refresh_token: refresh,
            grant_type: 'refresh_token',
          }),
        }
      );
      if (!response.ok)
        throw new Error(`Gmail authorization failed (${response.status})`);
      this.token = (await response.json()).access_token;
      if (!this.token) throw new Error('Gmail authorization returned no token');
    }
    const response = await this.fetcher(`${ROOT}${path}`, {
      ...options,
      signal: AbortSignal.timeout(20_000),
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok)
      throw new Error(`Gmail request failed (${response.status})`);
    return response.json();
  }

  async profile() {
    const profile = await this.request('/profile');
    if (email(profile.emailAddress) !== this.config.mailbox)
      throw new Error(
        'Connected Gmail account does not match the configured receiving mailbox'
      );
    const result = await this.request('/settings/sendAs');
    this.aliases = (result.sendAs || []).filter(
      (alias) => alias.isPrimary || alias.verificationStatus === 'accepted'
    );
    const sender = this.aliases.find(
      (alias) => alias.sendAsEmail.toLowerCase() === this.config.sender
    );
    if (!sender)
      throw new Error(
        'The outreach sender is not a verified Gmail sending alias'
      );
    if (/resend\./i.test(sender.smtpMsa?.host || ''))
      throw new Error('A Resend SMTP alias cannot be used for cold outreach');
    return sender.sendAsEmail;
  }

  async hasReply(lead) {
    // Search all folders, including archived mail, spam and trash. New-thread replies
    // from the prospect also stop the sequence. Any response, including an auto-reply,
    // stops it; interpreting intent and resuming is an operator decision.
    const query = `in:anywhere from:${lead.email}`;
    const result = await this.request(
      `/messages?${new URLSearchParams({ q: query, maxResults: '1', includeSpamTrash: 'true' })}`
    );
    if (result.messages?.length) return true;
    if (lead.messages.some((m) => m.status === 'sent')) {
      const bounceQuery = `in:anywhere {from:mailer-daemon from:postmaster} "${lead.email}" after:${Math.floor(lead.createdAt / 1000)}`;
      const bounces = await this.request(
        `/messages?${new URLSearchParams({ q: bounceQuery, maxResults: '1', includeSpamTrash: 'true' })}`
      );
      if (bounces.messages?.length) return true;
    }
    const ownAddresses = new Set(
      this.aliases.map((alias) => alias.sendAsEmail.toLowerCase())
    );
    ownAddresses.add(this.config.mailbox);
    for (const id of new Set(
      lead.messages.map((m) => m.threadId).filter(Boolean)
    )) {
      const thread = await this.request(
        `/threads/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From`
      );
      if (!Array.isArray(thread.messages))
        throw new Error('Gmail thread cannot be checked for replies');
      for (const message of thread.messages) {
        if (message.labelIds?.includes('DRAFT')) continue;
        const from = header(message, 'From');
        if (!from) throw new Error('Gmail message is missing its sender');
        const address = (from.match(/<([^>]+)>/)?.[1] || from)
          .trim()
          .toLowerCase();
        // Includes bounces and replies from another colleague in the same thread.
        if (!ownAddresses.has(address)) return true;
      }
    }
    return false;
  }

  async send(lead, message, index) {
    const previous = lead.messages[index - 1];
    return this.request('/messages/send', {
      method: 'POST',
      body: JSON.stringify({
        raw: mime(lead, message, index),
        ...(previous?.threadId ? { threadId: previous.threadId } : {}),
      }),
    });
  }

  async findSent(rfcId) {
    if (!rfcId)
      throw new Error('Cannot reconcile a message without its stable ID');
    const query = `in:sent rfc822msgid:${rfcId.replace(/[<>]/g, '')}`;
    const result = await this.request(
      `/messages?${new URLSearchParams({ q: query, maxResults: '2' })}`
    );
    if (!result.messages?.length) return null;
    if (result.messages.length !== 1)
      throw new Error(
        'Multiple delivery receipts require manual reconciliation'
      );
    const message = await this.request(
      `/messages/${encodeURIComponent(result.messages[0].id)}?format=metadata`
    );
    const sentAt = Number(message.internalDate);
    if (
      !message.id ||
      !message.threadId ||
      !Number.isFinite(sentAt) ||
      sentAt <= 0
    )
      throw new Error('Invalid delivery receipt');
    return { id: message.id, threadId: message.threadId, sentAt };
  }
}
