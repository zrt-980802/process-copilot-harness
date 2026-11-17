# Source Baseline

- Baseline date: 2026-11-17 (Asia/Shanghai)
- Status: `SOURCE_BASELINE_PUBLISHED`
- Source Product HEAD: `8e3134951ef478c5fb500457f8eda32d136e60c3`
- Source Product files: 494 tracked or non-ignored working-tree files
- Source Architecture files: 59
- Governance files: 2
- Baseline root commit: `935b84165d2d8a61c4af08036edc18a344422cb8`
- Private remote: `https://github.com/zrt-980802/process-copilot-harness`

## Source locations

- Product: `C:/Users/29557/.hermes-web-ui/.ekko/workspace/default/mw1g1vskatd2r8/product`
- Architecture: `C:/Users/29557/.hermes-web-ui/.ekko/workspace/default/mw1g1vskatd2r8/architecture`
- Migration handoff: `C:/Users/29557/Documents/ChatGPT/山子- PC`

The Product source had pre-existing tracked modifications and untracked files.
The baseline copies current file contents from `git ls-files` plus
`git ls-files -o --exclude-standard`; it does not claim those changes came
from a single commit.

## Included

- Product source, tests, contracts, migration SQL, reproducible deployment
  definitions and maintained documentation;
- all Architecture ADR and traceability sources;
- active MEMORY-01 requirements and the next-phase roadmap.

## Excluded

- `.git` metadata from source worktrees;
- `node_modules`, `dist`, coverage and editor caches;
- local `.docker` candidates, reports and generated test evidence;
- `.env`, credentials, private keys, database files and Runtime state;
- EE-Claw source, shared databases, container volumes and remote deployments.

The repository retains deterministic local-only fixture credentials used by
demo and acceptance automation, including names beginning with `Local` and
database passwords ending in `-only`. They are not production credentials and
must never be reused outside an isolated local environment. Real model keys
remain environment-only.

## Verification

Completed from the new directory:

```text
pnpm install --frozen-lockfile: pass
pnpm check: pass
23 ADRs and 60 Contracts traced
33 test files passed / 7 conditionally skipped
210 tests passed / 8 conditionally skipped
all workspace builds passed
fresh PostgreSQL 17 MEMORY-01A test passed
source-to-baseline SHA-256 comparison: Product 494/494, Architecture 59/59
```

The sensitive-content review found no private key, GitHub token, AWS key or
real model API key. The only token-shaped model key is an intentional negative
test fixture for Memory secret rejection. Git object inspection and remote hash
verification completed successfully during publication.

The initial staged whitespace check reports inherited trailing spaces and
extra final blank lines in historical Architecture Markdown files. Those files
remain byte-identical to the accepted source; this baseline does not silently
rewrite architecture evidence for formatting-only cleanup.
