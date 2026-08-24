import type { User } from "@server/entity/User";
import {
  validateAiToolCallArguments,
  type AiToolCall,
  type AiToolResult,
} from "@server/lib/aiAgent";
import {
  scoreAiEvalCase,
  type AiEvalCase,
  type AiEvalFixture,
} from "@server/lib/aiEval";
import { getAiRunModelConfig, runAiAgent } from "@server/lib/aiRunner";

const readStdin = async (): Promise<string> => {
  process.stdin.setEncoding("utf8");
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  return input;
};

const resultFromFixture = (fixture: AiEvalFixture): AiToolResult => ({
  content:
    typeof fixture.result === "string"
      ? fixture.result
      : JSON.stringify(fixture.result),
  ...(fixture.cards?.length ? { cards: fixture.cards } : {}),
});

const main = async () => {
  const testCase = JSON.parse(await readStdin()) as AiEvalCase;
  const config = getAiRunModelConfig();
  if (!config)
    throw new Error("AI_BASE_URL is required for model-backed evals.");
  const fixtureEscapes: string[] = [];
  const fixtureByTool = new Map<string, AiEvalFixture>();
  for (const fixture of testCase.fixtures) {
    fixtureByTool.set(fixture.tool, fixture);
  }
  const executeTool = async (call: AiToolCall): Promise<AiToolResult> => {
    if (!validateAiToolCallArguments(call)) {
      return {
        content: JSON.stringify({
          ok: false,
          code: "invalid_arguments",
          message: "Tool arguments did not match the allowed schema.",
        }),
      };
    }
    const fixture = fixtureByTool.get(call.name);
    if (!fixture) {
      fixtureEscapes.push(call.name);
      return {
        content: JSON.stringify({
          ok: false,
          code: "temporarily_unavailable",
          message: "No evaluation fixture exists for this tool call.",
        }),
      };
    }
    return resultFromFixture(fixture);
  };
  const user = { id: 0, permissions: 0 } as User;
  const result = await runAiAgent(
    { messages: testCase.messages, user, config },
    {},
    { executeTool }
  );
  const scores = scoreAiEvalCase(testCase, result.trace, fixtureEscapes);
  process.stdout.write(
    `${JSON.stringify({
      caseId: testCase.id,
      output: result.answer,
      trace: result.trace,
      fixtureEscapes,
      scores,
    })}\n`
  );
};

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack ?? error.message : String(error)}\n`
  );
  process.exitCode = 1;
});
