/**
 * Anthropic model pricing (USD per 1M tokens, approximate; check
 * https://www.anthropic.com/pricing for current rates). Used by the
 * Sessions dashboard to estimate cost per session. Returns null for
 * unknown models so the UI can render "—" instead of zero.
 */

export interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
}

const PRICES: Record<string, ModelPricing> = {
  // Opus 4.x (current generation)
  'claude-opus-4-7':       { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5,  cacheWritePer1M: 18.75 },
  'claude-opus-4-6':       { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5,  cacheWritePer1M: 18.75 },
  'claude-opus-4-5':       { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5,  cacheWritePer1M: 18.75 },
  // Sonnet 4.x
  'claude-sonnet-4-6':     { inputPer1M: 3,  outputPer1M: 15, cacheReadPer1M: 0.3,  cacheWritePer1M: 3.75 },
  'claude-sonnet-4-5':     { inputPer1M: 3,  outputPer1M: 15, cacheReadPer1M: 0.3,  cacheWritePer1M: 3.75 },
  // Haiku 4.x
  'claude-haiku-4-5':      { inputPer1M: 1,  outputPer1M: 5,  cacheReadPer1M: 0.1,  cacheWritePer1M: 1.25 },
};

/**
 * Normalise gateway model identifiers like "claude-cli/claude-sonnet-4-6"
 * down to "claude-sonnet-4-6" so the lookup table works regardless of the
 * vendor prefix.
 */
function normaliseModel(model: string): string {
  if (!model) return '';
  // Strip vendor prefix ("claude-cli/", "anthropic/", "openclaw/")
  const slashIdx = model.indexOf('/');
  const stripped = slashIdx >= 0 ? model.slice(slashIdx + 1) : model;
  return stripped.toLowerCase();
}

export function getPricing(model: string | null | undefined): ModelPricing | null {
  if (!model) return null;
  const key = normaliseModel(model);
  return PRICES[key] ?? null;
}

export function estimateCost(args: {
  model: string | null | undefined;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}): number | null {
  const pricing = getPricing(args.model);
  if (!pricing) return null;
  const i = (args.inputTokens ?? 0) / 1_000_000;
  const o = (args.outputTokens ?? 0) / 1_000_000;
  const cr = (args.cacheReadTokens ?? 0) / 1_000_000;
  const cw = (args.cacheWriteTokens ?? 0) / 1_000_000;
  return (
    i * pricing.inputPer1M +
    o * pricing.outputPer1M +
    cr * (pricing.cacheReadPer1M ?? 0) +
    cw * (pricing.cacheWritePer1M ?? 0)
  );
}

export function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  if (amount === 0) return '$0.00';
  if (amount < 0.01) return `<$0.01`;
  if (amount < 1) return `$${amount.toFixed(2)}`;
  if (amount < 100) return `$${amount.toFixed(2)}`;
  return `$${amount.toFixed(0)}`;
}
