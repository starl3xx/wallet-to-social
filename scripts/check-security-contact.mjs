#!/usr/bin/env node
/**
 * Checks, against production, the three facts about the security contact that
 * no file in this repository can show.
 *
 * `scripts/check-invariants.ts` proves what the code serves, and it never reads
 * the clock: a date comparison there would turn a required check red on every
 * PR the day the window closed. What is left is a set of facts about today and
 * about repository settings, and this is where they are checked, every Monday,
 * by `.github/workflows/security-contact.yml`.
 *
 *   1. The deployed /.well-known/security.txt answers 200, directly, as
 *      `text/plain; charset=utf-8`, with one Expires more than 30 days away.
 *      An expired file is ignored by every consumer, silently.
 *   2. GitHub private vulnerability reporting is enabled. It is the preferred
 *      Contact, and it is a repository setting that a click can switch off.
 *   3. GitHub renders the policy. The page answers 200 either way, and says
 *      "No security policy detected" when it has nothing to show, so the
 *      status alone proves nothing.
 *
 * The report form itself is not fetched: unauthenticated, it answers 302 to
 * the login page whether reporting is on or off.
 *
 * Run: GITHUB_TOKEN=$(gh auth token) node scripts/check-security-contact.mjs
 * (the token is optional; without it the API allows 60 requests an hour)
 */

const SECURITY_TXT = 'https://walletlink.social/.well-known/security.txt';
const PVR_API =
  'https://api.github.com/repos/starl3xx/wallet-to-social/private-vulnerability-reporting';
const POLICY_PAGE =
  'https://github.com/starl3xx/wallet-to-social/security/policy';
const MIN_DAYS_LEFT = 30;

const failures = [];
const fail = (message) => failures.push(message);

// ------------------------------------------------------------ security.txt
{
  // `manual`, so a redirect in front of the file is reported instead of
  // followed: section 3 wants the well-known URI to answer itself.
  const res = await fetch(SECURITY_TXT, { redirect: 'manual' });
  const type = res.headers.get('content-type');
  if (res.status !== 200) {
    fail(`${SECURITY_TXT} answered ${res.status}, not 200`);
  } else if (type !== 'text/plain; charset=utf-8') {
    fail(
      `${SECURITY_TXT} is served as "${type}", not text/plain; charset=utf-8`
    );
  } else {
    const body = await res.text();
    const expires = body
      .split('\n')
      .filter((line) => /^expires\s*:/i.test(line))
      .map((line) => line.slice(line.indexOf(':') + 1).trim());
    const at = Date.parse(expires[0] ?? '');
    const daysLeft = (at - Date.now()) / 864e5;
    if (expires.length !== 1) {
      fail(`security.txt carries ${expires.length} Expires fields, not 1`);
    } else if (!Number.isFinite(at)) {
      fail(`security.txt Expires "${expires[0]}" is not a date`);
    } else if (daysLeft <= MIN_DAYS_LEFT) {
      fail(
        `security.txt expires ${expires[0]}, ${Math.floor(daysLeft)} days from now. ` +
          'Re-test both channels, then renew it: docs/OPERATIONS.md, "The security contact".'
      );
    } else {
      console.log(
        `ok  security.txt: 200, text/plain; charset=utf-8, expires in ${Math.floor(daysLeft)} days`
      );
    }
  }
}

// ------------------------------------- GitHub private vulnerability reporting
{
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(PVR_API, { headers });
  const json = res.ok ? await res.json() : null;
  if (json?.enabled === true) {
    console.log('ok  private vulnerability reporting: enabled');
  } else {
    fail(
      `private vulnerability reporting is not enabled (${res.status}, ${JSON.stringify(json)}). ` +
        'The first Contact in security.txt points at it.'
    );
  }
}

// ----------------------------------------------------------- the policy page
{
  const res = await fetch(POLICY_PAGE, { redirect: 'manual' });
  const html = res.status === 200 ? await res.text() : '';
  if (res.status !== 200) {
    fail(`${POLICY_PAGE} answered ${res.status}, not 200`);
  } else if (html.includes('No security policy detected')) {
    fail(
      `${POLICY_PAGE} says "No security policy detected": SECURITY.md is not on the default branch`
    );
  } else {
    console.log('ok  the policy page renders SECURITY.md');
  }
}

if (failures.length) {
  for (const f of failures) console.error(`FAILED  ${f}`);
  process.exit(1);
}
console.log('security contact ok');
