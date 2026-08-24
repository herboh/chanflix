import {
  AI_AGENT_MAX_TOOL_CALLS,
  AI_AGENT_MAX_TOOL_ROUNDS,
  type AiMediaCard,
} from "@server/lib/aiAgent";
import type { AiChatMessage } from "@server/lib/aiChat";
import type { AiTraceJson, AiTraceV1 } from "@server/lib/aiTrace";

export interface AiEvalFixture {
  tool: string;
  result: AiTraceJson;
  cards?: AiMediaCard[];
}

export interface AiEvalArgumentExpectation {
  tool: string;
  contains: Record<string, AiTraceJson>;
  alternatives?: Array<Record<string, AiTraceJson>>;
}

export interface AiEvalExpected {
  requiredTools?: string[];
  requiredToolGroups?: string[][];
  allowedTools?: string[];
  forbiddenTools?: string[];
  toolSequence?: string[];
  arguments?: AiEvalArgumentExpectation[];
  cards?: Array<{ mediaType: "movie" | "tv"; tmdbId: number }>;
  requiredClaims?: string[];
  requiredClaimGroups?: string[][];
  forbiddenClaims?: string[];
  maxRounds?: number;
  maxToolCalls?: number;
}

export interface AiEvalCase {
  id: string;
  tags: string[];
  messages: AiChatMessage[];
  fixtures: AiEvalFixture[];
  expected: AiEvalExpected;
}

export interface AiEvalScores {
  routing: number;
  arguments: number;
  sequence: number;
  grounding: number;
  completion: number;
  safety: number;
  efficiency: number;
  overall: number;
  hardPass: number;
  hardFailures: string[];
  details: Record<string, unknown>;
}

const average = (values: number[]): number =>
  values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 1;

const containsValue = (actual: unknown, expected: unknown): boolean => {
  if (typeof actual === "string" && typeof expected === "string") {
    return (
      actual.trim().toLocaleLowerCase() === expected.trim().toLocaleLowerCase()
    );
  }
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      expected.every((item, index) => containsValue(actual[index], item))
    );
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      return false;
    }
    return Object.entries(expected as Record<string, unknown>).every(
      ([key, value]) =>
        containsValue((actual as Record<string, unknown>)[key], value)
    );
  }
  return actual === expected;
};

export const scoreAiEvalCase = (
  testCase: AiEvalCase,
  trace: AiTraceV1,
  fixtureEscapes: string[] = []
): AiEvalScores => {
  const expected = testCase.expected;
  const calledTools = trace.tools.map((tool) => tool.name);
  const requiredTools = expected.requiredTools ?? [];
  const requiredToolGroups = expected.requiredToolGroups ?? [];
  const forbiddenTools = expected.forbiddenTools ?? [];
  const allowedTools = new Set(expected.allowedTools ?? requiredTools);
  const missingTools = requiredTools.filter(
    (tool) => !calledTools.includes(tool)
  );
  const missingToolGroups = requiredToolGroups.filter(
    (tools) => !tools.some((tool) => calledTools.includes(tool))
  );
  const calledForbidden = forbiddenTools.filter((tool) =>
    calledTools.includes(tool)
  );
  const unexpectedTools = calledTools.filter(
    (tool) => allowedTools.size > 0 && !allowedTools.has(tool)
  );
  const routing = average([
    ...requiredTools.map((tool) => (calledTools.includes(tool) ? 1 : 0)),
    ...requiredToolGroups.map((tools) =>
      tools.some((tool) => calledTools.includes(tool)) ? 1 : 0
    ),
    ...forbiddenTools.map((tool) => (calledTools.includes(tool) ? 0 : 1)),
    ...(allowedTools.size
      ? calledTools.map((tool) => (allowedTools.has(tool) ? 1 : 0))
      : [calledTools.length ? 0 : 1]),
  ]);

  const argumentMatches = (expected.arguments ?? []).map((expectation) => {
    const calls = trace.tools.filter((tool) => tool.name === expectation.tool);
    const acceptableArguments = [
      expectation.contains,
      ...(expectation.alternatives ?? []).map((alternative) => ({
        ...expectation.contains,
        ...alternative,
      })),
    ];
    return {
      tool: expectation.tool,
      expected: acceptableArguments,
      actual: calls.map((tool) => tool.arguments),
      matched: calls.some((tool) =>
        acceptableArguments.some((acceptable) =>
          containsValue(tool.arguments, acceptable)
        )
      ),
    };
  });
  const argumentResults = argumentMatches.map((match) =>
    match.matched ? 1 : 0
  );
  const argumentsScore = average(argumentResults);
  const invalidArguments = trace.tools
    .filter(
      (tool) =>
        typeof tool.arguments === "string" ||
        tool.outcome === "invalid_arguments"
    )
    .map((tool) => tool.name);

  const expectedSequence = expected.toolSequence ?? [];
  const sequence = expectedSequence.length
    ? Number(
        expectedSequence.every((tool, index) => calledTools[index] === tool)
      )
    : 1;

  const expectedCards = expected.cards ?? [];
  const missingCards = expectedCards.filter(
    (card) =>
      !trace.cards.some(
        (actual) =>
          actual.mediaType === card.mediaType && actual.tmdbId === card.tmdbId
      )
  );
  const normalizedAnswer = trace.finalAnswer.toLocaleLowerCase();
  const missingClaims = (expected.requiredClaims ?? []).filter(
    (claim) => !normalizedAnswer.includes(claim.toLocaleLowerCase())
  );
  const missingClaimGroups = (expected.requiredClaimGroups ?? []).filter(
    (claims) =>
      !claims.some((claim) =>
        normalizedAnswer.includes(claim.toLocaleLowerCase())
      )
  );
  const forbiddenClaims = (expected.forbiddenClaims ?? []).filter((claim) =>
    normalizedAnswer.includes(claim.toLocaleLowerCase())
  );
  const grounding = average([
    ...expectedCards.map((card) =>
      trace.cards.some(
        (actual) =>
          actual.mediaType === card.mediaType && actual.tmdbId === card.tmdbId
      )
        ? 1
        : 0
    ),
    ...(expected.requiredClaims ?? []).map((claim) =>
      normalizedAnswer.includes(claim.toLocaleLowerCase()) ? 1 : 0
    ),
    ...(expected.requiredClaimGroups ?? []).map((claims) =>
      claims.some((claim) =>
        normalizedAnswer.includes(claim.toLocaleLowerCase())
      )
        ? 1
        : 0
    ),
    ...(expected.forbiddenClaims ?? []).map((claim) =>
      normalizedAnswer.includes(claim.toLocaleLowerCase()) ? 0 : 1
    ),
  ]);

  const maxRounds = expected.maxRounds ?? AI_AGENT_MAX_TOOL_ROUNDS + 1;
  const maxToolCalls = expected.maxToolCalls ?? AI_AGENT_MAX_TOOL_CALLS;
  const exceededRounds = trace.rounds.length > maxRounds;
  const exceededTools = trace.tools.length > maxToolCalls;
  const completion = Number(
    !!trace.finalAnswer && !trace.errorCode && trace.finishReason !== "unknown"
  );
  const hardFailures = [
    ...(trace.errorCode ? [`trace_error:${trace.errorCode}`] : []),
    ...(!trace.finalAnswer.trim() ? ["missing_final_answer"] : []),
    ...fixtureEscapes.map((tool) => `fixture_escape:${tool}`),
    ...invalidArguments.map((tool) => `invalid_arguments:${tool}`),
    ...calledForbidden.map((tool) => `forbidden_tool:${tool}`),
    ...(exceededRounds ? ["round_limit_exceeded"] : []),
    ...(exceededTools ? ["tool_limit_exceeded"] : []),
  ];
  const safety = Number(hardFailures.length === 0);
  const efficiency = Number(!exceededRounds && !exceededTools);
  const componentScores = [
    routing,
    argumentsScore,
    sequence,
    grounding,
    completion,
    safety,
    efficiency,
  ];

  return {
    routing,
    arguments: argumentsScore,
    sequence,
    grounding,
    completion,
    safety,
    efficiency,
    overall: average(componentScores),
    hardPass: Number(hardFailures.length === 0),
    hardFailures,
    details: {
      calledTools,
      missingTools,
      missingToolGroups,
      calledForbidden,
      unexpectedTools,
      argumentMismatches: argumentMatches.filter((match) => !match.matched),
      missingCards,
      missingClaims,
      missingClaimGroups,
      forbiddenClaims,
      rounds: trace.rounds.length,
      toolCalls: trace.tools.length,
      durationMs: trace.durationMs,
      totalCompletionTokens: trace.totalCompletionTokens,
    },
  };
};
