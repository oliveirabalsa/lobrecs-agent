import type { ModelPricing } from '../../shared/types'

export const MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-haiku-4-5-20251001": { inputPer1M: 0.8, outputPer1M: 4 },
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-opus-4-8": { inputPer1M: 15, outputPer1M: 25 },
  "claude-opus-4-7": { inputPer1M: 15, outputPer1M: 25 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "gpt-5.3-codex-spark": { inputPer1M: 0.25, outputPer1M: 1 },
  "gpt-5.3-codex": { inputPer1M: 0.5, outputPer1M: 2.5 },
  "gpt-5.4-mini": { inputPer1M: 0.5, outputPer1M: 2 },
  "gpt-5.4": { inputPer1M: 2, outputPer1M: 8 },
  "gpt-5.5": { inputPer1M: 15, outputPer1M: 30 },
  "gpt-5": { inputPer1M: 0, outputPer1M: 0 },
  minimax: { inputPer1M: 0.1, outputPer1M: 0.3 },
  "minimax/MiniMax-M2": { inputPer1M: 0.1, outputPer1M: 0.3 },
  "minimax/MiniMax-M2.5": { inputPer1M: 0.1, outputPer1M: 0.3 },
  "minimax/MiniMax-M2.7": { inputPer1M: 0.1, outputPer1M: 0.3 },
  "minimax/MiniMax-M3": {
    inputPer1M: 0.6,
    outputPer1M: 2.4,
    cachedReadPer1M: 0.12,
    cachedWritePer1M: 0.75,
  },
  "gemini-2.0-flash-lite": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-2.5-flash": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-3.0-pro": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-3.0-flash": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-3.1-pro": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-3.5-flash": { inputPer1M: 0, outputPer1M: 0 },
  "gemini-3.5-pro": { inputPer1M: 0, outputPer1M: 0 },
  "flash-lite": { inputPer1M: 0, outputPer1M: 0 },
  "flash": { inputPer1M: 0, outputPer1M: 0 },
  "pro": { inputPer1M: 0, outputPer1M: 0 },
  "auto": { inputPer1M: 0, outputPer1M: 0 },
};

export function estimateCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  pricingOverrides: Record<string, ModelPricing> = {},
): number {
  const pricing = pricingOverrides[model] ?? MODEL_PRICING[model];
  if (!pricing) {
    return 0;
  }

  const normalizedTokensIn = normalizeTokenCount(tokensIn);
  const normalizedTokensOut = normalizeTokenCount(tokensOut);

  return (
    (normalizedTokensIn / 1_000_000) * pricing.inputPer1M +
    (normalizedTokensOut / 1_000_000) * pricing.outputPer1M
  );
}

export function estimateFromPrompt(
  model: string,
  promptLength: number,
): number {
  const normalizedPromptLength = normalizeTokenCount(promptLength);
  const estimatedTokensIn = Math.ceil(normalizedPromptLength * 0.75);

  return estimateCost(model, estimatedTokensIn, estimatedTokensIn * 3);
}

function normalizeTokenCount(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.ceil(value);
}
