# CI/CD Setup — Replik.ai

## Overview

| Layer | Mechanism | Trigger |
|---|---|---|
| Local quality gate | Lefthook pre-commit | `git commit` |
| PR validation | GitHub Actions `ci.yml` | PR open/update, push to `main` |
| Next.js deploy | Vercel GitHub integration | push to `main` + PRs |
| Trigger.dev deploy | GitHub Actions `trigger-deploy.yml` | push to `main` (task files changed) |

---

## 1. Vercel — One-time Setup (manual)

Vercel auto-detects Next.js. `vercel.json` sets `bun install --frozen-lockfile` as the install command.

**Steps:**
1. Go to [vercel.com/new](https://vercel.com/new) → Import Git repository → select `Enriquefft/replik`.
2. Vercel detects Next.js automatically; framework overrides come from `vercel.json`.
3. Set all required environment variables (see list below) in the Vercel dashboard under **Settings → Environment Variables**.
4. Enable automatic deployments (default). PR previews are enabled by default.

**Required environment variables in Vercel:**

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk publishable key (safe to expose; prefix enforced by Next.js) |
| `CLERK_SECRET_KEY` | Clerk secret key — backend only |
| `DATABASE_URL` | Neon Postgres connection string (`postgresql://...`) |
| `ENCRYPTION_KEY` | 32-byte hex symmetric key for pgp_sym_encrypt (`openssl rand -hex 32`) |
| `TRIGGER_SECRET_KEY` | Trigger.dev secret key for SDK auth |
| `TRIGGER_PROJECT_ID` | Trigger.dev project ID (from dashboard or `trigger.config.ts` at runtime) |
| `ANTHROPIC_API_KEY` | Anthropic API key |
| `OPENAI_API_KEY` | OpenAI API key |
| `APIFY_TOKEN` | Apify token (FB Ads scraping fallback) |
| `UPLOADTHING_TOKEN` | UploadThing token for asset hosting |
| `META_AD_LIBRARY_TOKEN` | Meta Ad Library access token |

---

## 2. GitHub Actions — Required Secrets

Add these in **GitHub → Settings → Secrets and variables → Actions**:

| Secret name | Used by | Notes |
|---|---|---|
| `TRIGGER_ACCESS_TOKEN` | `trigger-deploy.yml` | Generate in Trigger.dev dashboard → Personal Access Tokens |
| `TRIGGER_PROJECT_ID` | `trigger-deploy.yml` | Your Trigger.dev project ID (e.g. `proj_abc123`) |

The CI workflow (`ci.yml`) uses **build-time placeholder values** for all env vars — it does not need real secrets. Real secrets are never needed at build time; they're needed at runtime (Vercel).

---

## 3. Branch Protection — Recommended Settings

Apply via GitHub dashboard: **Settings → Branches → Add rule** for `main`.

Or apply with `gh` CLI (confirm before running — these are irreversible without admin access):

```bash
# Require PRs before merge
gh api repos/Enriquefft/replik/branches/main/protection \
  --method PUT \
  --field required_status_checks='{"strict":true,"contexts":["verify"]}' \
  --field enforce_admins=false \
  --field required_pull_request_reviews='{"required_approving_review_count":1}' \
  --field restrictions=null \
  --field allow_force_pushes=false \
  --field allow_deletions=false \
  --field required_linear_history=true
```

**Settings to enable:**
- Require a pull request before merging
- Require status checks to pass before merging
  - Required check: **`verify`** (the CI job name in `ci.yml`)
- Require branches to be up to date before merging
- Require linear history (optional but recommended for clean `git log`)
- Do not allow bypassing the above settings

---

## 4. Pre-commit Hook (Lefthook)

Lefthook is installed as a dev dependency. The `prepare` script runs `lefthook install` automatically on `bun install`.

To install manually:
```bash
bunx lefthook install
```

To test on a clean tree:
```bash
bunx lefthook run pre-commit
```

The hook runs in parallel:
- **lint**: `biome check` on staged `.ts/.tsx/.js/.jsx/.json` files
- **typecheck**: full `tsc --noEmit` on any staged `.ts/.tsx` change

---

## 5. Trigger.dev — Project ID

`trigger.config.ts` reads `TRIGGER_PROJECT_ID` from environment at deploy time. Set this:
- Locally in `.env.local`
- In Vercel environment variables (for server-side SDK usage at runtime)
- In GitHub Actions secret `TRIGGER_PROJECT_ID` (for `trigger-deploy.yml`)

Find your project ID in the Trigger.dev dashboard under **Project Settings**.
