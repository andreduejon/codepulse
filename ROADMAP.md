# Roadmap

What the next releases are for. A plan, not a promise: real use decides the details, and each release takes one
theme. Every provider but Git stays off by default.

## v0.21.0 — Stabilization

- Daily use on real repositories with real tokens: fix what that turns up, add nothing new.
- GitHub pull requests checked against a real repository and GitHub Enterprise (v0.20.0 was checked on the demo's
  data only).
- The one test run that failed once and could not be repeated: find it, or make it fail every time.

## v0.22.0 — Stabilization, refactoring, a calmer Dashboard

- **Fewer colours:** only what needs attention (failed, warning, running) in colour; passed, opened and merged muted.
  A provider's colour on its badge, not on every row.
- **Fewer rows:** repeats in a knot fold into one (`✓ 10 runs`), opened with Enter; failures always show.
- **Problems only:** one key that hides everything that passed, beside `:hide <provider>`.
- **One set of marks** for the Dashboard and the provider tabs, with one legend.
- **Refactoring** with more golden plays first, so `bun run demo:golden` shows that nothing changed.

## v0.23.0 — GitHub pull requests, completed (read-only)

- Review state per pull request (approved, changes requested, pending) in its tab and as a mark on its chip.
- Review comments beside the lines they are about, in the diff dialog.
- Required checks and whether it can merge, as GitHub reports them.

## v0.24.0 — Sonar provider

- A commit's quality gate and new issues, as Snyk shows its scan: SonarQube and SonarCloud.
- Analyses exist for branches and pull requests, not for every commit: a commit without one says so.
