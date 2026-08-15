# ADR-004 — npm workspaces instead of Bun

**Status:** Accepted · **Date:** 2026-08-15

## Context

The model repository, `cyalcala/va-freelance-hub`, uses Bun workspaces and
`oven-sh/setup-bun` in CI. Emulating its structure would suggest carrying that
choice over.

## Decision

Use **npm workspaces** and Node 22.

## Rationale

**Verified availability.** Node 22.13.1 and npm 10.9.2 were confirmed present in
the environment where this repo was scaffolded. Bun was not verified. Building a
handoff on an unverified runtime is a needless first obstacle for whoever picks
it up.

**Handoff surface.** This repository is explicitly designed to be continued by
an autonomous coding model, possibly in a container that may not have Bun
preinstalled. npm is present everywhere Node is, and `actions/setup-node` with
npm caching is the most boring, best-documented path in GitHub Actions.

**No feature dependency.** Nothing here needs Bun. There is no Bun-specific API
in use, the test runner is Vitest either way, and Wrangler is invoked via `npx`.
The only real loss is install speed.

## Consequences

**Good:** works on any Node 22 machine; the most conventional CI setup; one less
thing for an implementing model to install or debug.

**Bad:** slower installs than Bun. Divergence from the model repo, so its
`package.json` scripts and workflow steps are not copy-pasteable — they need
translating. That translation cost is paid once, here.

**Encountered during scaffolding:** npm's
[optional-dependency bug](https://github.com/npm/cli/issues/4828) surfaced as a
missing `@rollup/rollup-win32-x64-msvc` after a `--no-save` install, breaking
Vitest until the platform binary was installed explicitly. This is a known npm
issue and worth recognizing on sight rather than debugging from scratch. If it
appears, remove `node_modules` and `package-lock.json` and reinstall.

## Reversal

If Bun becomes clearly preferable, migration is mechanical: swap
`actions/setup-node` for `oven-sh/setup-bun` in seven workflow files, change
`npm ci` to `bun install --frozen-lockfile`, and update the script prefixes.
No source code changes.
