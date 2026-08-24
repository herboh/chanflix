# Chanflix AI evaluations

This directory exercises the same TypeScript agent runner used by production.
Inspect AI provides run logs and aggregate scores; deterministic fixture tools
prevent evaluation prompts from reaching Plex, TMDB, web search, or request
services.

## Run

The model must already be available through the configured llama-swap endpoint:

```bash
AI_BASE_URL=http://192.168.1.2:8080/v1 AI_MODEL=qwen-main yarn ai:eval:smoke --live
AI_BASE_URL=http://192.168.1.2:8080/v1 AI_MODEL=qwen-main yarn ai:eval --case library-recent --live
AI_BASE_URL=http://192.168.1.2:8080/v1 AI_MODEL=qwen-main yarn ai:eval --live
```

Use the address on which llama-swap is actually listening. This host binds the
gateway to `192.168.1.2`; a loopback URL will fail before contacting the model.

Every model-backed invocation requires the explicit `--live` flag and prints
the exact case count before inference starts. Smoke runs are limited to ten
samples and one concurrent agent. Use `--case ID` for the smallest possible
targeted check.

Inspect logs and the JSON summary are written under ignored `evals/logs/` and
`evals/reports/` directories. A run exits non-zero for invalid tool arguments,
forbidden tools, missing fixtures, permission violations, or loop-limit
failures. Transport/model errors and missing final answers also fail the run,
so an unavailable gateway cannot look like a successful canary. After changing
only fixtures or scoring, replay a saved run without loading or contacting the
model:

```bash
yarn ai:eval:replay evals/logs/<run>.eval
```

## Feedback loop

Production stores privacy-filtered trajectories for 30 days. Authenticated
users can rate their own answers. An administrator can export negatively rated
examples locally with:

```bash
yarn ai:eval:export
```

Exports are written with mode `0600` under ignored `evals/review/`. Never commit
an exported conversation. Review the failure, replace private text and results
with a synthetic fixture, then add the synthetic regression case to
`cases/regression.jsonl`.

Keep future fine-tuning data separate from this regression set. Models must not
train on held-out evaluation cases used to compare the current 27B model with a
smaller fine-tuned model.

## Prompt rollback

`server/lib/aiSystemPrompts.ts` keeps both the active evaluation-loop prompt and
the frozen production baseline from `dev@9d2c53e`. The final assignment in that
file is the one-line rollout/rollback switch. The baseline is protected by a
unit-test fingerprint and should never be edited in place.
