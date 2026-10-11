/**
 * Pins the Claude Code effort catalog (CLI 2.1.289) onto OmniRoute's model metadata.
 *
 * The shipped catalog marks 11 models as effort-capable, and every one of them
 * carries `max_effort`. OmniRoute used to withhold `max` from claude-sonnet-5-5
 * in two places — the family denylist behind supportsClaudeMaxEffort() and the
 * registry's supportedThinkingEfforts — so a requested `max` was silently
 * lowered to `xhigh` by the per-model capability clamp in
 * open-sse/executors/base/reasoningEffort.ts.
 *
 * These cases pin all three layers (capability predicate, registry vocabulary,
 * runtime sanitizer) so a regression on any one of them fails here.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  getModelsByProviderId,
  supportsClaudeMaxEffort,
  supportsXHighEffort,
} from "../../open-sse/config/providerModels.ts";
import { sanitizeReasoningEffortForProvider } from "../../open-sse/executors/base/reasoningEffort.ts";

/** The 11 effort-capable entries of the Claude Code 2.1.289 catalog. */
const EFFORT_CAPABLE_MODELS = [
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-sonnet-5-5",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-opus-5-5",
  "claude-fable-5",
  "claude-fable-5-1",
  "claude-mythos-5-1",
] as const;

/** Catalog entries that carry no `xhigh_effort` capability. */
const NO_XHIGH_MODELS = ["claude-sonnet-4-6", "claude-opus-4-6"] as const;

test("every effort-capable Claude Code model supports the max tier", () => {
  for (const modelId of EFFORT_CAPABLE_MODELS) {
    assert.equal(supportsClaudeMaxEffort(modelId), true, modelId);
    assert.equal(supportsClaudeMaxEffort(`claude/${modelId}`), true, `claude/${modelId}`);
  }
});

test("the Haiku family is still withheld from the max tier", () => {
  assert.equal(supportsClaudeMaxEffort("claude-haiku-4-5-20251001"), false);
  assert.equal(supportsClaudeMaxEffort("claude-3-5-haiku-20241022"), false);
  assert.equal(supportsClaudeMaxEffort("anthropic/claude-haiku-4.5"), false);
});

test("models without xhigh_effort keep their xhigh opt-out", () => {
  for (const modelId of NO_XHIGH_MODELS) {
    assert.equal(supportsXHighEffort("claude", modelId), false, modelId);
  }
});

test("the Claude registry advertises max for Sonnet 5.5", () => {
  const sonnet55 = getModelsByProviderId("claude").find(
    (model) => model.id === "claude-sonnet-5-5"
  );
  assert.ok(sonnet55, "claude-sonnet-5-5 missing from the claude registry");
  assert.deepEqual(sonnet55.supportedThinkingEfforts, ["low", "medium", "high", "xhigh", "max"]);
  assert.equal(sonnet55.supportsXHighEffort, true);
});

test("a requested max reaches Sonnet 5.5 unchanged on every effort carrier", () => {
  const topLevel = sanitizeReasoningEffortForProvider(
    { reasoning_effort: "max" },
    "claude",
    "claude-sonnet-5-5"
  ) as { reasoning_effort: string };
  assert.equal(topLevel.reasoning_effort, "max");

  // Native Claude Code wire image (#7044 carrier 3).
  const nativeClaude = sanitizeReasoningEffortForProvider(
    { output_config: { effort: "max" } },
    "claude",
    "claude-sonnet-5-5"
  ) as { output_config: { effort: string } };
  assert.equal(nativeClaude.output_config.effort, "max");
});

test("Opus 4.6 takes max but still degrades xhigh, which it does not accept", () => {
  const max = sanitizeReasoningEffortForProvider(
    { reasoning_effort: "max" },
    "claude",
    "claude-opus-4-6"
  ) as { reasoning_effort: string };
  assert.equal(max.reasoning_effort, "max");

  const xhigh = sanitizeReasoningEffortForProvider(
    { reasoning_effort: "xhigh" },
    "claude",
    "claude-opus-4-6"
  ) as { reasoning_effort: string };
  assert.equal(xhigh.reasoning_effort, "max");
});
