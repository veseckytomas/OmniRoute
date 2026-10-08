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

test("the Sonnet 4.x line is withheld from max while Opus 4.6/4.8 stay eligible", () => {
  // Operator-verified: Sonnet 4.5 / 4.6 top out below max in Claude Code. The registry
  // marks every Claude model supportsThinking, so the family gate is the only guard.
  assert.equal(supportsClaudeMaxEffort("claude-sonnet-4-5"), false);
  assert.equal(supportsClaudeMaxEffort("claude-sonnet-4-5-20250929"), false);
  assert.equal(supportsClaudeMaxEffort("claude-sonnet-4-6"), false);
  assert.equal(supportsClaudeMaxEffort("cc/claude-sonnet-4-6"), false);
  // Opus 4.6/4.8 are a different family and keep max.
  assert.equal(supportsClaudeMaxEffort("claude-opus-4-6"), true);
  assert.equal(supportsClaudeMaxEffort("claude-opus-4-8"), true);
  assert.equal(supportsClaudeMaxEffort("claude-sonnet-5"), true);
});

test("Sonnet 4.x keeps its pre-existing low/medium/high ladder without max", () => {
  for (const id of ["claude-sonnet-4-5-20250929", "claude-sonnet-4-6"]) {
    const levels = claudeEffortLevelsFor("claude", id);
    assert.equal(levels.includes(CLAUDE_MAX_EFFORT_LEVEL), false, id);
    assert.deepEqual(levels.slice(0, 3), ["low", "medium", "high"], id);
  }

  const variants = appendClaudeEffortVariants([model("claude/claude-sonnet-4-6")]);
  const ids = new Set(variants.map(({ id }) => id));
  assert.equal(ids.has("claude/claude-sonnet-4-6-max"), false);
  assert.equal(ids.has("claude/claude-sonnet-4-6-high"), true);
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
