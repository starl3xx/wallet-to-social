# Security runbook — walletlink.social

This document is the operational security reference for the production database
and secrets. It exists because the dataset went from ~5k throwaway rows to a
4.7M-wallet asset, and the database's **integrity** posture had a single point
of failure: every consumer (Vercel app, the GitHub Actions Farcaster sweep,
local scripts, migrations) connects as the one `neondb_owner` role, which owns
every table and can `DROP` all of them. A leak of any one `DATABASE_URL` copy
means total, unrecoverable loss.

The three fixes below are ordered by priority. Items marked **[you]** require
the Neon console or credential access and must be run by the account owner;
items marked **[shipped]** are already in the repo.

---

## 1. Split the one god-mode role into three scoped roles **[you]**

Today `neondb_owner` is used everywhere. Create three least-privilege login
roles and re-point each consumer at the narrowest one it needs. Run this SQL in
the Neon SQL Editor **as `neondb_owner`** (roles created via SQL work fine;
they just won't show as "managed" in the Neon Roles UI, which is acceptable).

There are **no sequences** in this schema (all PKs are `uuid`/`text` defaults),
so no sequence grants are required.

```sql
-- ============================================================================
-- Role 1: sweep_runner — the GitHub Actions monthly Farcaster sweep.
-- Only touches social_graph, and creates/drops its own per-run seen tables.
-- Cannot read users/api_keys or drop anyone else's tables.
-- ============================================================================
CREATE ROLE sweep_runner WITH LOGIN PASSWORD '<GENERATE-A-STRONG-ONE>';
GRANT USAGE, CREATE ON SCHEMA public TO sweep_runner;   -- CREATE: for farcaster_sweep_seen_<ts>
GRANT SELECT, INSERT, UPDATE, DELETE ON social_graph TO sweep_runner;

-- ============================================================================
-- Role 2: app_runtime — the Vercel app (every request path).
-- Full row-level CRUD, but NO DDL: cannot DROP or ALTER tables, cannot drop
-- the database. A leaked app_runtime URL can read/modify rows (it must, to
-- serve the product) but cannot destroy the schema.
-- ============================================================================
CREATE ROLE app_runtime WITH LOGIN PASSWORD '<GENERATE-A-STRONG-ONE>';
GRANT USAGE ON SCHEMA public TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
-- Future tables (e.g. new migrations) should inherit the same grant:
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_runtime;

-- ============================================================================
-- Role 3: backup_reader — the nightly encrypted dump. Read-only, and only the
-- irreplaceable tables. Lowest privilege of the three.
-- ============================================================================
CREATE ROLE backup_reader WITH LOGIN PASSWORD '<GENERATE-A-STRONG-ONE>';
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON users, api_keys, api_plans, whitelist, lookup_history, known_agents
  TO backup_reader;
```

**Re-point consumers** (keep `neondb_owner` only for schema migrations, run
manually from your laptop):

| Consumer | Was | Point at |
|----------|-----|----------|
| Vercel `DATABASE_URL` | `neondb_owner` | **`app_runtime`** |
| GitHub Actions `DATABASE_URL` (sweep) | `neondb_owner` | **`sweep_runner`** |
| GitHub Actions `BACKUP_DATABASE_URL` (new) | — | **`backup_reader`** |
| Local `.env.local` (migrations only) | `neondb_owner` | keep `neondb_owner` |

Get each role's connection string from Neon (Dashboard → Connection Details →
select the role), or take the existing owner URL and swap the `user:password@`
segment for the new role's.

> **DDL note:** hand-migration scripts (`scripts/migrate-*.ts`) do `CREATE
> TABLE`/`ALTER`, so they must run as `neondb_owner` from your laptop, not as
> `app_runtime`. That's why the local `.env.local` keeps the owner credential.
> After a migration adds a table, grant `app_runtime` on it (the
> `ALTER DEFAULT PRIVILEGES` above handles this automatically for tables the
> owner creates thereafter).

---

## 2. Nightly encrypted backup of the irreplaceable tables **[shipped, needs secrets]**

The Farcaster graph is rebuildable (~115 min sweep, ~3.3M free Neynar credits;
ENS re-scans from block 7,000,000 in minutes; holdings reseed from the daily
cron). What is **not** rebuildable: `users` (emails, tiers, Stripe ids),
`api_keys`, `whitelist`, `lookup_history`, `known_agents`. Total size: a few MB.

`.github/workflows/db-backup.yml` (shipped) dumps exactly those tables nightly,
encrypts with [age](https://github.com/FiloSottile/age) using a **public** key
(the private key never touches the runner), and uploads the ciphertext as a
90-day GitHub Actions artifact.

Two operational constraints, both verified against production:

- **Use the non-pooled host** for `BACKUP_DATABASE_URL` — drop `-pooler` from
  the hostname. `pg_dump` needs a real session (it sets `statement_timeout` and
  holds a consistent snapshot); Neon's pooler is PgBouncer in transaction mode
  and cannot serve it.
- **The client major must be ≥ the server major.** Neon is on PostgreSQL 17 and
  `pg_dump` aborts outright against a newer server, so the workflow installs
  `postgresql-client-17` from PGDG rather than Ubuntu's default 16. If Neon ever
  moves to 18, bump that pin or the nightly job starts failing.

**To activate it, set two repo secrets:**

1. `BACKUP_DATABASE_URL` — the `backup_reader` connection string from step 1.
2. `BACKUP_AGE_PUBLIC_KEY` — an age recipient public key. Generate a keypair on
   your machine and keep the private key offline:
   ```sh
   age-keygen -o walletlink-backup.agekey     # prints the public key; store the file safely, NOT in the repo
   ```
   Put the `age1...` public key in the secret. To restore later:
   ```sh
   age -d -i walletlink-backup.agekey backup-YYYY-MM-DD.sql.age > restore.sql
   psql "$DATABASE_URL" < restore.sql
   ```

For retention beyond 90 days, change the upload step to push to an R2/S3 bucket
(the encryption step is unchanged — the ciphertext is safe to store anywhere).

---

## 3. Credential rotation **[you]**

The owner `DATABASE_URL` and `NEYNAR_API_KEY` currently live in **three** trust
domains each (Vercel, GitHub Actions, laptop). After the role split lands, the
owner credential's blast radius shrinks, but the values that have been in three
places should be rotated once. Order:

1. **`neondb_owner` password** — rotate in Neon; update **only** local
   `.env.local` (owner is no longer used by Vercel/Actions after step 1).
2. **`NEYNAR_API_KEY`** — rotate in the Neynar dashboard; update Vercel + the
   GitHub Actions secret + local `.env.local`.
3. **`ADMIN_PASSWORD`** — rotate; update Vercel + local. Use a long random value
   (the new `requireAdmin` fails closed if unset and has lockout, but the secret
   still needs to be strong).
4. **`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`** — roll in the Stripe
   dashboard; update Vercel.
5. **`ALCHEMY_KEY`, `MORALIS_API_KEY`, `WEB3BIO_API_KEY`, `OPENSEA_API_KEY`** —
   lower urgency (read-only third-party data); rotate on a relaxed schedule.

### Secret inventory

| Secret | Vercel | GH Actions | Laptop `.env.local` | Notes |
|--------|:------:|:----------:|:-------------------:|-------|
| `DATABASE_URL` | app_runtime | sweep_runner | neondb_owner | after step 1 |
| `BACKUP_DATABASE_URL` | — | backup_reader | — | new |
| `BACKUP_AGE_PUBLIC_KEY` | — | ✓ | — | public key only |
| `NEYNAR_API_KEY` | ✓ | ✓ | ✓ | |
| `ADMIN_PASSWORD` | ✓ | — | ✓ | |
| `STRIPE_SECRET_KEY` | ✓ | — | — | |
| `STRIPE_WEBHOOK_SECRET` | ✓ | — | — | |
| `ALCHEMY_KEY` | ✓ | — | ✓ | |
| `MORALIS_API_KEY` | ✓ | — | — | |
| `WEB3BIO_API_KEY` | ✓ | — | ✓ | |
| `OPENSEA_API_KEY` | ✓ | — | ✓ | |
| `CRON_SECRET` | ✓ | — | — | guards /api/cron/* |

---

## Already in place

- **Git history is clean** — no real secrets ever committed; `.env*` is
  gitignored (`.gitignore:34`). Consider adding `gitleaks` as a CI check (the
  baseline is trivially clean today).
- **Workflow triggers are safe** — the sweep runs on `schedule` +
  `workflow_dispatch` only (no `pull_request`), so fork PRs can't reach the
  secrets, and secrets are step-scoped. Hardening still worth doing: pin the
  `actions/checkout` + `actions/setup-node` SHAs and add top-level
  `permissions: contents: read`.
- **API surface** — unauthenticated result leak closed (PR #23); per-account
  quotas, timing-safe admin auth, trusted client IP, and session-bound tier
  (PR #24).
