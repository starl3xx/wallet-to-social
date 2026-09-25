import { email, NotSubmittedError } from './engine.mjs';

const ROOT = 'https://gmail.googleapis.com/gmail/v1/users/me';
const header = (message, name) =>
  message.payload?.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  )?.value;

export function mime(lead, message, index) {
  const previous = lead.messages[index - 1];
  const headers = [
    message.senderName
      ? `From: =?UTF-8?B?${Buffer.from(message.senderName).toString('base64')}?= <${message.from}>`
      : `From: ${message.from}`,
    `To: ${lead.email}`,
    `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
    `Message-ID: ${message.rfcId}`,
    `Date: ${new Date(message.attemptedAt ?? lead.createdAt).toUTCString()}`,
    ...(message.deliveryId
      ? [`X-WalletLink-Delivery-ID: ${message.deliveryId}`]
      : []),
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

  async authorize() {
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
  }

  async request(path, options = {}) {
    await this.authorize();
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
    // Everything before the send request only reads: authorization, the
    // canonical IDs of earlier messages, and the MIME. A failure here submitted
    // nothing, so it is thrown as NotSubmittedError and the message stays queued.
    // The send request itself must stay outside this block: once it starts,
    // a failure can follow a delivery, and the engine treats it as uncertain.
    let raw;
    let threadId;
    try {
      await this.authorize();
      const previousMessages = [];
      for (const previous of lead.messages.slice(0, index)) {
        const receipt = await this.findSent(previous.rfcId, {
          lead,
          message: previous,
        });
        if (!receipt)
          throw new Error('Previous message is not verified in Sent Mail');
        previousMessages.push({ ...previous, rfcId: receipt.rfcId });
        threadId = receipt.threadId;
      }
      raw = mime(
        { ...lead, messages: [...previousMessages, message] },
        message,
        index
      );
    } catch (error) {
      throw new NotSubmittedError(error);
    }
    return this.request('/messages/send', {
      method: 'POST',
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    });
  }

  async findSent(rfcId, { lead, message: expected } = {}) {
    if (!rfcId)
      throw new Error('Cannot reconcile a message without its stable ID');
    const address = (value) =>
      (value?.match(/<([^>]+)>/)?.[1] || value || '').trim().toLowerCase();
    const inspect = async (id, byProviderId = false) => {
      const found = await this.request(
        `/messages/${encodeURIComponent(id)}?format=metadata`
      );
      if (!found.labelIds?.includes('SENT')) return null;
      if (
        lead &&
        (address(header(found, 'To')) !== lead.email ||
          address(header(found, 'From')) !== expected.from)
      )
        return null;
      const actualId = header(found, 'Message-ID');
      const markerMatches =
        expected?.deliveryId &&
        header(found, 'X-WalletLink-Delivery-ID') === expected.deliveryId;
      if (!byProviderId && actualId !== rfcId && !markerMatches) return null;
      const sentAt = Number(found.internalDate);
      if (
        !found.id ||
        !found.threadId ||
        !Number.isFinite(sentAt) ||
        sentAt <= 0 ||
        !/^<[^<>\s]+@[^<>\s]+>$/.test(actualId || '')
      )
        throw new Error('Invalid delivery receipt');
      return {
        id: found.id,
        threadId: found.threadId,
        sentAt,
        rfcId: actualId,
      };
    };
    if (expected?.providerId) {
      const receipt = await inspect(expected.providerId, true);
      if (!receipt)
        throw new Error(
          'Stored provider receipt does not match the sent message'
        );
      return receipt;
    }
    const matches = new Map();
    const inspected = new Set();
    const collect = async (result) => {
      for (const item of result.messages || []) {
        if (inspected.has(item.id)) continue;
        inspected.add(item.id);
        const receipt = await inspect(item.id);
        if (receipt) matches.set(receipt.id, receipt);
      }
      if (matches.size > 1)
        throw new Error(
          'Multiple delivery receipts require manual reconciliation'
        );
    };
    const exact = await this.request(
      `/messages?${new URLSearchParams({ q: `in:sent rfc822msgid:${rfcId.replace(/[<>]/g, '')}`, maxResults: '2' })}`
    );
    await collect(exact);
    if (exact.nextPageToken)
      throw new Error(
        'Multiple delivery receipts require manual reconciliation'
      );
    // Gmail may rewrite Message-ID. Search a bounded time window and inspect
    // exact custom markers, never infer delivery from subject/body similarity.
    if (expected?.deliveryId && Number.isFinite(expected.attemptedAt) && lead) {
      let pageToken;
      for (let page = 0; page < 5; page++) {
        const query = `in:sent after:${Math.floor(expected.attemptedAt / 1000) - 60} before:${Math.ceil(expected.attemptedAt / 1000) + 86400}`;
        const params = new URLSearchParams({ q: query, maxResults: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const result = await this.request(`/messages?${params}`);
        await collect(result);
        pageToken = result.nextPageToken;
        if (!pageToken) break;
        if (page === 4)
          throw new Error(
            'Sent Mail scan limit reached; manual reconciliation required'
          );
      }
    }
    return [...matches.values()][0] || null;
  }
}
