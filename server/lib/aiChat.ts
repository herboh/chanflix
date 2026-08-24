export const AI_CHAT_MAX_MESSAGES = 32;
export const AI_CHAT_MAX_MESSAGE_CHARS = 16_000;
export const AI_CHAT_MAX_TOTAL_CHARS = 64_000;

export type AiChatRole = "user" | "assistant";

export interface AiChatMessage {
  role: AiChatRole;
  content: string;
}

export interface AiChatUpstreamEvent {
  reasoning?: string;
  content?: string;
  finishReason?: string;
  done?: boolean;
  error?: string;
  toolCall?: {
    index: number;
    id?: string;
    name?: string;
    arguments?: string;
  };
}

export class AiChatValidationError extends Error {
  public readonly status = 400;
}

export const validateAiChatMessages = (value: unknown): AiChatMessage[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new AiChatValidationError("At least one message is required.");
  }

  if (value.length > AI_CHAT_MAX_MESSAGES) {
    throw new AiChatValidationError(
      `A chat can contain at most ${AI_CHAT_MAX_MESSAGES} messages.`
    );
  }

  let totalChars = 0;
  const messages = value.map((message, index): AiChatMessage => {
    if (!message || typeof message !== "object") {
      throw new AiChatValidationError("Every message must be an object.");
    }

    const candidate = message as Record<string, unknown>;
    const expectedRole: AiChatRole = index % 2 === 0 ? "user" : "assistant";

    if (candidate.role !== expectedRole) {
      throw new AiChatValidationError(
        "Messages must alternate between user and assistant."
      );
    }

    if (typeof candidate.content !== "string") {
      throw new AiChatValidationError("Every message must contain text.");
    }

    const content = candidate.content.trim();
    if (!content) {
      throw new AiChatValidationError("Messages cannot be empty.");
    }

    if (content.length > AI_CHAT_MAX_MESSAGE_CHARS) {
      throw new AiChatValidationError(
        `A message can contain at most ${AI_CHAT_MAX_MESSAGE_CHARS} characters.`
      );
    }

    totalChars += content.length;
    if (totalChars > AI_CHAT_MAX_TOTAL_CHARS) {
      throw new AiChatValidationError(
        `A chat can contain at most ${AI_CHAT_MAX_TOTAL_CHARS} characters.`
      );
    }

    return { role: expectedRole, content };
  });

  if (messages[messages.length - 1].role !== "user") {
    throw new AiChatValidationError("The final message must be from the user.");
  }

  return messages;
};

export class AiChatConcurrencyGate {
  private readonly activeUsers = new Set<number>();
  private activeGlobal = 0;

  constructor(private readonly maxGlobal: number) {}

  public acquire(userId: number): (() => void) | undefined {
    if (this.activeUsers.has(userId) || this.activeGlobal >= this.maxGlobal) {
      return undefined;
    }

    this.activeUsers.add(userId);
    this.activeGlobal += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.activeUsers.delete(userId);
      this.activeGlobal = Math.max(0, this.activeGlobal - 1);
    };
  }

  public get activeCount(): number {
    return this.activeGlobal;
  }
}

const parseUpstreamData = (data: string): AiChatUpstreamEvent[] => {
  if (data === "[DONE]") {
    return [{ done: true }];
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(data) as Record<string, unknown>;
  } catch (_error) {
    return [{ error: "The model returned an invalid stream." }];
  }

  if (payload.error) {
    return [{ error: "The model could not complete this request." }];
  }

  const choices = payload.choices;
  if (
    !Array.isArray(choices) ||
    !choices[0] ||
    typeof choices[0] !== "object"
  ) {
    return [];
  }

  const choice = choices[0] as Record<string, unknown>;
  const delta =
    choice.delta && typeof choice.delta === "object"
      ? (choice.delta as Record<string, unknown>)
      : {};
  const events: AiChatUpstreamEvent[] = [];
  const reasoning =
    typeof delta.reasoning === "string"
      ? delta.reasoning
      : typeof delta.reasoning_content === "string"
      ? delta.reasoning_content
      : undefined;

  if (reasoning) {
    events.push({ reasoning });
  }
  if (typeof delta.content === "string" && delta.content) {
    events.push({ content: delta.content });
  }
  if (Array.isArray(delta.tool_calls)) {
    for (const rawToolCall of delta.tool_calls) {
      if (!rawToolCall || typeof rawToolCall !== "object") continue;
      const toolCall = rawToolCall as Record<string, unknown>;
      const fn =
        toolCall.function && typeof toolCall.function === "object"
          ? (toolCall.function as Record<string, unknown>)
          : {};
      if (typeof toolCall.index !== "number") continue;
      events.push({
        toolCall: {
          index: toolCall.index,
          ...(typeof toolCall.id === "string" ? { id: toolCall.id } : {}),
          ...(typeof fn.name === "string" ? { name: fn.name } : {}),
          ...(typeof fn.arguments === "string"
            ? { arguments: fn.arguments }
            : {}),
        },
      });
    }
  }
  if (typeof choice.finish_reason === "string" && choice.finish_reason) {
    events.push({ finishReason: choice.finish_reason });
  }

  return events;
};

export class AiChatSseParser {
  private buffer = "";

  public push(chunk: string): AiChatUpstreamEvent[] {
    this.buffer = (this.buffer + chunk).replace(/\r\n/g, "\n");
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";

    return blocks.flatMap((block) => this.parseBlock(block));
  }

  public finish(): AiChatUpstreamEvent[] {
    if (!this.buffer.trim()) {
      return [];
    }

    const events = this.parseBlock(this.buffer);
    this.buffer = "";
    return events;
  }

  private parseBlock(block: string): AiChatUpstreamEvent[] {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");

    return data ? parseUpstreamData(data) : [];
  }
}
