import assert from "node:assert/strict";
import test from "node:test";

import {
  splitClaudeEffortSuffix,
  supportsClaudeMaxEffort,
} from "../../open-sse/config/providerModels.ts";
import {
  appendClaudeEffortVariants,
  claudeEffortLevelsFor,
  CLAUDE_MAX_EFFORT_LEVEL,
} from "../../open-sse/utils/claudeEffortVariants.ts";

const model = (id: string) => ({
  id,
  owned_by: id.split("/")[0],
  name: id.split("/").pop(),
});

test("Claude Code catalog advertises max for supported Claude models", () => {
  const variants = appendClaudeEffortVariants([
    model("claude/claude-fable-5"),
    model("claude/claude-sonnet-5-5"),
  ]);
  const ids = new Set(variants.map(({ id }) => id));

  assert.equal(CLAUDE_MAX_EFFORT_LEVEL, "max");
  assert.equal(ids.has("claude/claude-fable-5-max"), true);
  assert.equal(ids.has("claude/claude-sonnet-5-5-max"), true);
});

test("max capability excludes only known unsupported Claude effort families", () => {
  assert.equal(supportsClaudeMaxEffort("claude-fable-5"), true);
  assert.equal(supportsClaudeMaxEffort("claude/claude-sonnet-5-5"), true);
  assert.equal(supportsClaudeMaxEffort("claude-opus-4-5"), false);
  assert.equal(supportsClaudeMaxEffort("claude-opus-4-5-20251101"), false);
  assert.equal(supportsClaudeMaxEffort("claude-opus-4-50"), true);
  assert.equal(supportsClaudeMaxEffort("claude-haiku-4-5-20251001"), false);
  assert.equal(supportsClaudeMaxEffort("gpt-5.5"), false);
});

test("effort levels include max once only when the model supports it", () => {
  assert.deepEqual(claudeEffortLevelsFor("claude", "claude-fable-5"), [
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ]);
  assert.deepEqual(claudeEffortLevelsFor("claude", "claude-opus-4-5-20251101"), [
    "low",
    "medium",
    "high",
  ]);
  assert.deepEqual(claudeEffortLevelsFor("claude", "claude-haiku-4-5-20251001"), [
    "low",
    "medium",
    "high",
  ]);
});

test("generated max ids parse back to the base model without double suffixing", () => {
  const variants = appendClaudeEffortVariants([
    model("claude/claude-fable-5"),
    model("claude/claude-fable-5-max"),
  ]);
  const ids = variants.map(({ id }) => id);

  assert.equal(
    ids.some((id) => id.endsWith("-max-max")),
    false
  );
  assert.deepEqual(splitClaudeEffortSuffix("claude-fable-5-max"), {
    baseModel: "claude-fable-5",
    effort: "max",
  });
});
