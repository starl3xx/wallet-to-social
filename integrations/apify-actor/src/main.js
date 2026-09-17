import { Actor, log } from 'apify';

/**
 * walletlink.social as an Apify Actor.
 *
 * ## Why this exists
 *
 * On 2026-09-16 the query "find twitter account from ethereum wallet address"
 * was won by an Apify Actor, and walletlink.social did not appear on it at all.
 * Apify pages rank because apify.com has the authority walletlink does not, so
 * the cheapest way onto that query is to be on Apify rather than to out-rank it.
 *
 * ## The method is the product
 *
 * The incumbent searches X for posts CONTAINING an address and asks a model who
 * the owner probably is. That is inverted: the commonest reason an address
 * appears in a post is that it belongs to somebody else, in a scam call-out or a
 * dust complaint. This Actor returns only identities the wallet owner published
 * themselves, each labelled with the class of evidence behind it, and returns
 * nothing rather than a guess. Every field it emits is auditable.
 */

const API_BASE = 'https://walletlink.social/api/v1';
const ADDRESS_RE = /0x[a-fA-F0-9]{40}/g;

/** Start at the smallest documented plan ceiling and shrink only if told to. */
const START_BATCH = 50;

const SIGNUP = 'https://walletlink.social';

/**
 * One HTTP call with retries.
 *
 * 429 and 5xx are retried with backoff because they are transient. 401, 402 and
 * 400 are not: a missing key, an empty balance and a malformed request do not
 * improve by being asked again, and retrying a 402 would just burn the run.
 */
async function call(path, apiKey, { method = 'GET', body } = {}) {
  const url = `${API_BASE}${path}`;
  let lastError;

  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) {
      const waitMs = 1000 * 2 ** attempt;
      log.info(`Retrying in ${waitMs / 1000}s (attempt ${attempt + 1} of 4)`);
      await new Promise((r) => setTimeout(r, waitMs));
    }

    let response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      lastError = error;
      continue;
    }

    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text.slice(0, 300) };
    }

    if (response.ok) return json;

    // Branch on `code`, never on the human-readable `error` string: the strings
    // are documented as rewordable and the codes are the contract.
    const code = json.code ?? `HTTP_${response.status}`;
    if (response.status === 429 || response.status >= 500) {
      lastError = new Error(`${code}: ${json.error ?? response.statusText}`);
      continue;
    }
    const err = new Error(`${code}: ${json.error ?? response.statusText}`);
    err.code = code;
    err.status = response.status;
    throw err;
  }
  throw lastError ?? new Error('Request failed after retries');
}

/** Every EVM address in a blob of text, deduplicated, lowercased. */
function extractAddresses(...sources) {
  const out = new Set();
  for (const source of sources) {
    if (!source) continue;
    const text = Array.isArray(source) ? source.join('\n') : String(source);
    for (const match of text.match(ADDRESS_RE) ?? [])
      out.add(match.toLowerCase());
  }
  return [...out];
}

/**
 * One record flattened to a spreadsheet row.
 *
 * Flat on purpose: the dataset is exported to CSV and Excel far more often than
 * it is read as JSON, and a nested object becomes "[object Object]" in both.
 *
 * Absent is not false. The API omits a field it never measured rather than
 * nulling it, and that distinction is the product: `x_reachability` empty means
 * the handle was not checked, never that nobody is behind it.
 */
function toRow(wallet, record) {
  if (!record) {
    return {
      wallet,
      found: false,
      x_handle: null,
      x_url: null,
      x_verified: null,
      x_reachability: null,
      farcaster_username: null,
      farcaster_url: null,
      farcaster_followers: null,
      farcaster_fid: null,
      ens_name: null,
      lens: null,
      github: null,
      evidence: null,
      is_agent: null,
      agent_name: null,
      last_updated: null,
      stale: null,
      locked: false,
    };
  }

  const twitter = record.twitter ?? {};
  const farcaster = record.farcaster ?? {};
  const agent = record.agent ?? {};

  return {
    wallet: record.wallet ?? wallet,
    found: Boolean(record.twitter || record.farcaster),
    x_handle: twitter.handle ?? null,
    x_url: twitter.url ?? null,
    x_verified: 'verified' in twitter ? twitter.verified : null,
    // live | suspended | unclaimed | reassigned, or null when unmeasured.
    x_reachability: twitter.reachability ?? null,
    farcaster_username: farcaster.username ?? null,
    farcaster_url: farcaster.url ?? null,
    farcaster_followers: farcaster.followers ?? null,
    farcaster_fid: farcaster.fid ?? null,
    ens_name: record.ens_name ?? null,
    lens: record.lens ?? null,
    github: record.github ?? null,
    // Evidence CLASSES, never a provider name.
    evidence: Array.isArray(record.sources) ? record.sources.join(', ') : null,
    is_agent: agent.is_agent ?? null,
    agent_name: agent.name ?? null,
    last_updated: record.last_updated ?? null,
    stale: record.stale ?? null,
    locked: record.locked ?? false,
  };
}

/**
 * The row emitted when the run cannot proceed.
 *
 * It MUST write at least one item. Apify re-runs the default input daily and
 * requires a non-empty dataset within five minutes; three empty days in a row
 * mark the Actor "under maintenance". A run that exits 0 with nothing in the
 * dataset looks fine in the log and still fails that test, which is exactly
 * what happened on build 0.1.2.
 *
 * It carries real index coverage rather than only an apology, read from the
 * keyless public stats endpoint, so the default run is worth looking at and the
 * Store sample output shows real numbers instead of an error.
 */
async function explain(message, detail) {
  log.warning(message);

  let stats = null;
  try {
    const response = await fetch('https://walletlink.social/api/public-stats');
    if (response.ok) stats = await response.json();
  } catch {
    // Coverage is a nicety; the row has to be written either way.
  }

  await Actor.pushData({
    status: 'needs_api_key',
    message,
    detail,
    get_a_free_key: SIGNUP,
    free_allowance: '100 matches every 30 days, and misses never count',
    index_wallets: stats?.total_wallets ?? null,
    index_with_farcaster: stats?.farcaster ?? null,
    index_with_x_handle: stats?.twitter ?? null,
  });
}

await Actor.init();

/**
 * Everything runs inside one function with a single exit at the end.
 *
 * The first version called Actor.exit() from inside each early-return branch.
 * Actor.exit() tears the process down, and on the platform that raced the
 * dataset write: the log showed the warning and the dataset came back empty.
 * Returning instead lets the write settle before the one exit below.
 */
async function run() {
  const input = (await Actor.getInput()) ?? {};
  const {
    lookupMode = 'wallets',
    walletAddresses,
    walletText,
    handle,
    apiKey,
    includeMisses = true,
    maxReversePages = 1,
  } = input;

  /**
   * No key is a successful run, not a failure, and the difference matters
   * operationally: Apify runs the default input daily and three consecutive
   * failures mark an Actor "under maintenance". Exiting non-zero here would let a
   * missing optional field deprecate the listing.
   */
  if (!apiKey) {
    await explain(
      'No walletlink.social API key was provided, so nothing was looked up.',
      `Create a free key at ${SIGNUP}, then put it in the "walletlink.social API key" field. Keys start with wts_live_.`
    );
    return;
  }

  if (lookupMode === 'wallets') {
    const wallets = extractAddresses(walletAddresses, walletText);

    if (wallets.length === 0) {
      await explain(
        'No EVM wallet addresses were found in the input.',
        'Add addresses to "Wallet addresses", or paste a CSV column into "Or paste addresses".'
      );
      return;
    }

    log.info(`Resolving ${wallets.length} distinct wallet addresses`);

    let size = START_BATCH;
    let index = 0;
    let matched = 0;
    let emitted = 0;

    while (index < wallets.length) {
      const chunk = wallets.slice(index, index + size);
      let result;
      try {
        result = await call('/batch', apiKey, {
          method: 'POST',
          body: { wallets: chunk },
        });
      } catch (error) {
        if (error.code === 'BATCH_SIZE_EXCEEDED' && size > 1) {
          // The ceiling is the caller's plan, not a constant, so learn it rather
          // than assume it.
          size = Math.max(1, Math.floor(size / 2));
          log.info(
            `Batch ceiling is lower than ${chunk.length}; retrying at ${size}`
          );
          continue;
        }
        if (error.code === 'NO_CREDITS') {
          log.warning(
            `Match balance is exhausted after ${matched} matches. Stopping with ${emitted} rows already saved. Top up at ${SIGNUP}/pricing`
          );
          break;
        }
        if (error.status === 401) {
          await explain(
            'That API key was not accepted.',
            `Check it starts with wts_live_ and has not been revoked. Manage keys at ${SIGNUP}`
          );
          break;
        }
        throw error;
      }

      const records = result.data ?? [];
      // `data` is in DEDUPLICATED SUBMISSION ORDER, so pair it index-by-index
      // with the chunk rather than trusting any field inside the record.
      for (let i = 0; i < chunk.length; i++) {
        const row = toRow(chunk[i], records[i]);
        if (row.found) matched++;
        if (row.found || includeMisses) {
          await Actor.pushData(row);
          emitted++;
        }
      }

      index += chunk.length;
      log.info(
        `${Math.min(index, wallets.length)}/${wallets.length} addresses, ${matched} matched`
      );
    }

    log.info(
      `Done. ${matched} of ${wallets.length} wallets resolved to an X or Farcaster account.`
    );
  } else {
    const cleaned = String(handle ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();

    if (!cleaned) {
      await explain(
        'No handle was given for a reverse lookup.',
        'Put the X handle or Farcaster username in the "Handle to look up" field.'
      );
      return;
    }

    const path = lookupMode === 'x_handle' ? 'twitter' : 'farcaster';
    log.info(
      `Finding wallets attested to ${path === 'twitter' ? '@' : ''}${cleaned}`
    );
    log.warning(
      'A reverse page returns up to 100 wallets and costs one match credit per wallet returned.'
    );

    let cursor = null;
    let page = 0;
    let total = 0;

    while (page < maxReversePages) {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      let result;
      try {
        result = await call(
          `/reverse/${path}/${encodeURIComponent(cleaned)}${query}`,
          apiKey
        );
      } catch (error) {
        if (error.code === 'NO_CREDITS') {
          log.warning(
            `Match balance exhausted after ${total} wallets. Top up at ${SIGNUP}/pricing`
          );
          break;
        }
        if (error.status === 401) {
          await explain(
            'That API key was not accepted.',
            `Check it starts with wts_live_ and has not been revoked. Manage keys at ${SIGNUP}`
          );
          break;
        }
        throw error;
      }

      const rows = result.data ?? [];
      for (const record of rows) {
        await Actor.pushData({
          ...toRow(record.wallet, record),
          looked_up: cleaned,
          quality_score: record.quality_score ?? null,
        });
        total++;
      }

      page++;
      const meta = result.meta ?? {};
      log.info(
        `Page ${page}: ${rows.length} wallets (${total} of ${meta.total_count ?? '?'} total)`
      );
      cursor = meta.next_cursor ?? null;
      if (!cursor) break;
    }

    // Never a silent cap: a truncated result that does not say so reads as a
    // complete one.
    if (cursor) {
      log.warning(
        `Stopped at ${maxReversePages} page(s); more wallets are attested to this handle. Raise "pages to fetch" to continue.`
      );
    }
    log.info(`Done. ${total} wallets returned.`);
  }
}

await run();
await Actor.exit();
