# /// script
# requires-python = ">=3.11"
# dependencies = [
#   "inspect-ai>=0.3.120,<0.4",
# ]
# ///

from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from inspect_ai import Task, eval, task
from inspect_ai.dataset import MemoryDataset, Sample
from inspect_ai.log import EvalLog, read_eval_log
from inspect_ai.model import ModelOutput
from inspect_ai.scorer import Score, Target, mean, scorer
from inspect_ai.solver import Generate, Solver, TaskState, solver

ROOT = Path(__file__).resolve().parents[1]
CASES_PATH = ROOT / "evals" / "cases" / "regression.jsonl"
SCORE_KEYS = (
    "routing",
    "arguments",
    "sequence",
    "grounding",
    "completion",
    "safety",
    "efficiency",
    "overall",
    "hardPass",
)


def load_cases(case_ids: set[str] | None = None) -> MemoryDataset:
    samples: list[Sample] = []
    available_ids: set[str] = set()
    with CASES_PATH.open(encoding="utf-8") as cases_file:
        for line in cases_file:
            if not line.strip():
                continue
            case = json.loads(line)
            available_ids.add(case["id"])
            if case_ids and case["id"] not in case_ids:
                continue
            samples.append(
                Sample(
                    id=case["id"],
                    input=case["messages"][-1]["content"],
                    target="",
                    metadata={"case": case, "tags": case.get("tags", [])},
                )
            )
    missing_ids = (case_ids or set()) - available_ids
    if missing_ids:
        raise ValueError(f"Unknown case ID(s): {', '.join(sorted(missing_ids))}")
    return MemoryDataset(samples=samples, name="chanflix-agent-regression")


@solver
def chanflix_agent() -> Solver:
    async def solve(state: TaskState, _generate: Generate) -> TaskState:
        process = await asyncio.create_subprocess_exec(
            "yarn",
            "-s",
            "ts-node",
            "-r",
            "tsconfig-paths/register",
            "--project",
            "server/tsconfig.json",
            "server/scripts/runAiEvalCase.ts",
            cwd=ROOT,
            env=os.environ.copy(),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await process.communicate(
            json.dumps(state.metadata["case"]).encode("utf-8")
        )
        if process.returncode != 0:
            raise RuntimeError(stderr.decode("utf-8", errors="replace"))
        result = json.loads(stdout.decode("utf-8"))
        state.metadata["chanflix_result"] = result
        state.output = ModelOutput.from_content(
            model=result["trace"]["model"]["alias"],
            content=result["output"],
            stop_reason="stop",
        )
        return state

    return solve


@scorer(metrics={"*": [mean()]})
def chanflix_trajectory():
    async def score(state: TaskState, _target: Target) -> Score:
        result = state.metadata["chanflix_result"]
        scores = result["scores"]
        return Score(
            value={key: float(scores[key]) for key in SCORE_KEYS},
            answer=result["output"],
            explanation=json.dumps(
                {
                    "hardFailures": scores["hardFailures"],
                    "details": scores["details"],
                },
                sort_keys=True,
            ),
            metadata={
                "traceId": result["trace"]["traceId"],
                "tags": state.metadata.get("tags", []),
            },
        )

    return score


@task
def chanflix_agent_eval(case_ids: tuple[str, ...] = ()) -> Task:
    return Task(
        dataset=load_cases(set(case_ids)),
        solver=chanflix_agent(),
        scorer=chanflix_trajectory(),
    )


def rescore_log(log: EvalLog) -> None:
    samples = log.samples or []
    current_cases: dict[str, dict[str, Any]] = {}
    with CASES_PATH.open(encoding="utf-8") as cases_file:
        for line in cases_file:
            if line.strip():
                case = json.loads(line)
                current_cases[case["id"]] = case
    replay_inputs: list[dict[str, Any]] = []
    replay_results: list[dict[str, Any]] = []
    for sample in samples:
        result = sample.metadata.get("chanflix_result")
        case = current_cases.get(str(sample.id))
        if not isinstance(result, dict) or not isinstance(case, dict):
            continue
        replay_inputs.append({"case": case, "trace": result["trace"]})
        replay_results.append(result)

    if not replay_inputs:
        raise ValueError("The Inspect log has no replayable Chanflix traces.")

    process = subprocess.run(
        [
            "yarn",
            "-s",
            "ts-node",
            "-r",
            "tsconfig-paths/register",
            "--project",
            "server/tsconfig.json",
            "server/scripts/scoreAiEvalTraces.ts",
        ],
        cwd=ROOT,
        input=json.dumps(replay_inputs),
        capture_output=True,
        check=False,
        text=True,
    )
    if process.returncode != 0:
        raise RuntimeError(process.stderr)
    rescored = json.loads(process.stdout)
    if len(rescored) != len(replay_results):
        raise RuntimeError("Replay scorer returned an unexpected result count.")
    for result, replay in zip(replay_results, rescored, strict=True):
        result["fixtureEscapes"] = replay["fixtureEscapes"]
        result["scores"] = replay["scores"]


def write_summary(logs: list[Any], report_path: Path) -> list[str]:
    samples: list[dict[str, Any]] = []
    hard_failures: list[str] = []
    totals = {key: 0.0 for key in SCORE_KEYS}
    count = 0
    for log in logs:
        for sample in log.samples or []:
            result = sample.metadata.get("chanflix_result", {})
            scores = result.get("scores", {})
            if not scores:
                continue
            count += 1
            for key in SCORE_KEYS:
                totals[key] += float(scores[key])
            if scores["hardFailures"]:
                hard_failures.append(str(sample.id))
            samples.append(
                {
                    "id": sample.id,
                    "tags": sample.metadata.get("tags", []),
                    "output": result.get("output", ""),
                    "trace": result.get("trace"),
                    "fixtureEscapes": result.get("fixtureEscapes", []),
                    "scores": {key: scores[key] for key in SCORE_KEYS},
                    "hardFailures": scores["hardFailures"],
                    "details": scores["details"],
                }
            )
    report = {
        "samples": count,
        "mean": {
            key: (totals[key] / count if count else 0.0) for key in SCORE_KEYS
        },
        "hardFailureCases": hard_failures,
        "results": samples,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    report_path.chmod(0o600)
    print(json.dumps(report["mean"], indent=2))
    print(f"Report: {report_path}")
    return hard_failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Chanflix agent eval set.")
    parser.add_argument("--limit", type=int)
    parser.add_argument(
        "--case",
        action="append",
        dest="case_ids",
        help="Run one named case; repeat for multiple cases.",
    )
    parser.add_argument("--max-connections", type=int, default=1)
    parser.add_argument(
        "--live",
        action="store_true",
        help="Explicitly allow requests to the configured live model.",
    )
    parser.add_argument(
        "--replay",
        help="Re-score a saved Inspect .eval log without contacting a model.",
    )
    parser.add_argument("--log-dir", default="evals/logs")
    parser.add_argument(
        "--report", default="evals/reports/latest-summary.json"
    )
    args = parser.parse_args()
    if not 1 <= args.max_connections <= 3:
        parser.error("--max-connections must be between 1 and 3")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if args.live and args.replay:
        parser.error("--live and --replay cannot be combined")

    if args.replay:
        log_path = (ROOT / args.replay).resolve()
        if not log_path.is_file():
            parser.error(f"Inspect log not found: {log_path}")
        log = read_eval_log(
            log_path,
            resolve_attachments=True,
            exclude_fields={"events", "messages", "store", "attachments"},
        )
        rescore_log(log)
        failures = write_summary([log], ROOT / args.report)
        if failures:
            raise SystemExit(
                f"Hard replay failures in {len(failures)} case(s): "
                + ", ".join(failures)
            )
        return

    selected_ids = set(args.case_ids or [])
    try:
        dataset = load_cases(selected_ids)
    except ValueError as error:
        parser.error(str(error))
    case_count = len(dataset)
    if args.limit is not None:
        case_count = min(case_count, args.limit)
    if not args.live:
        parser.error(
            f"refusing to contact the live model for {case_count} case(s) "
            "without the explicit --live flag"
        )
    if not os.environ.get("AI_BASE_URL"):
        parser.error("AI_BASE_URL is required for a live model evaluation")

    print(
        f"LIVE MODEL EVAL: {case_count} case(s), "
        f"model={os.environ.get('AI_MODEL', 'qwen-main')}, "
        f"max_connections={args.max_connections}",
        file=sys.stderr,
        flush=True,
    )
    logs = eval(
        chanflix_agent_eval(tuple(sorted(selected_ids))),
        model="mockllm/model",
        limit=args.limit,
        max_connections=args.max_connections,
        max_samples=args.max_connections,
        log_dir=str(ROOT / args.log_dir),
    )
    failures = write_summary(logs, ROOT / args.report)
    if failures:
        raise SystemExit(
            f"Hard eval failures in {len(failures)} case(s): {', '.join(failures)}"
        )


if __name__ == "__main__":
    main()
