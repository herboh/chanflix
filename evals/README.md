# Chanflix AI evaluations

This directory exercises the same TypeScript agent runner used by production.
Inspect AI provides run logs and aggregate scores; deterministic fixture tools
prevent evaluation prompts from reaching Plex, TMDB, web search, or request
services.

## Run

The model must already be available through the configured llama-swap endpoint:

```bash
AI_BASE_URL=http://127.0.0.1:8080/v1 AI_MODEL=qwen-main yarn ai:eval:smoke --live
AI_BASE_URL=http://127.0.0.1:8080/v1 AI_MODEL=qwen-main yarn ai:eval --case library-recent --live
AI_BASE_URL=http://127.0.0.1:8080/v1 AI_MODEL=qwen-main yarn ai:eval --live
```

Every model-backed invocation requires the explicit `--live` flag and prints
the exact case count before inference starts. Smoke runs are limited to ten
samples and one concurrent agent. Use `--case ID` for the smallest possible
targeted check.

Inspect logs and the JSON summary are written under ignored `evals/logs/` and
`evals/reports/` directories. A run exits non-zero for invalid tool arguments,
forbidden tools, missing fixtures, permission violations, or loop-limit
failures. After changing only fixtures or scoring, replay a saved run without
loading or contacting the model:

```bash
yarn ai:eval:replay evals/logs/<run>.eval
```

## Feedback loop

Production stores redacted trajectories for 30 days. Authenticated users can
rate their own answers. An administrator can export negatively rated examples
locally with:

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
