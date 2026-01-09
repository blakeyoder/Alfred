/**
 * Shared types for LLM tool call evaluators.
 */

export interface ToolCall {
  toolName: string;
  args: Record<string, unknown>;
}

export interface EvaluatorResult {
  name: string;
  value: number;
  comment?: string;
}

export interface LLMOutput {
  toolCalls: ToolCall[];
  text: string;
}
