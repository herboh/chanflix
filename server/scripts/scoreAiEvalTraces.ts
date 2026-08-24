import { scoreAiEvalCase, type AiEvalCase } from "@server/lib/aiEval";
import type { AiTraceV1 } from "@server/lib/aiTrace";

interface ReplayInput {
  case: AiEvalCase;
  trace: AiTraceV1;
}

const readStdin = async (): Promise<string> => {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const main = async () => {
  const inputs = JSON.parse(await readStdin()) as ReplayInput[];
  if (!Array.isArray(inputs)) throw new Error("Replay input must be an array.");

  const results = inputs.map((input) => {
    const fixtureTools = new Set(
      input.case.fixtures.map((fixture) => fixture.tool)
    );
    const fixtureEscapes = [
      ...new Set(
        input.trace.tools
          .map((tool) => tool.name)
          .filter((tool) => !fixtureTools.has(tool))
      ),
    ];
    return {
      caseId: input.case.id,
      fixtureEscapes,
      scores: scoreAiEvalCase(input.case, input.trace, fixtureEscapes),
    };
  });

  process.stdout.write(`${JSON.stringify(results)}\n`);
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
