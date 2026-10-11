/**
 * Runtime plumbing for the per-target combo effort pin.
 *
 * The persistence layer (src/lib/combos/steps.ts) and the builder UI already
 * round-trip a model step's `effort`, but the pin only matters if it reaches
 * the dispatched body. This covers the two seams that carry it:
 *
 *   1. normalizeRuntimeStep (open-sse/services/combo/comboStructure.ts) must
 *      forward `effort` from the persisted step onto the ResolvedComboTarget.
 *   2. applyComboTargetEffortPin (executeTargetAttempt.ts) must write the pin
 *      as `output_config.effort` on the per-target attempt body — the one shape
 *      that outranks both the caller's effort and the per-model default the
 *      Claude executor stamps on when `output_config` is absent — while leaving
 *      an unpinned body, and a non-Claude target, byte-identical.
 *
 * Top-level `reasoning_effort` is deliberately NOT written: the native Claude
 * passthrough forwards unknown top-level keys verbatim and Anthropic has no
 * such field, so writing it leaks an OpenAI-shaped key upstream.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { resolveNestedComboTargets } from "../../open-sse/services/combo/comboStructure.ts";
import { applyComboTargetEffortPin } from "../../open-sse/services/combo/executeTargetAttempt.ts";
import type { ResolvedComboTarget } from "../../open-sse/services/combo/types.ts";

function resolveSingleTarget(step: Record<string, unknown>): ResolvedComboTarget {
  const targets = resolveNestedComboTargets(
    { name: "c", models: [step] } as never,
    { c: { name: "c", models: [step] } } as never
  );
  const target = targets.find((entry) => entry.kind === "model");
  assert.ok(target, "expected a resolved model target");
  return target as ResolvedComboTarget;
}

const pinnedTarget = (effort?: string) =>
  ({ kind: "model", modelStr: "claude/claude-opus-5-5", ...(effort ? { effort } : {}) }) as never;

test("a persisted step effort reaches the resolved combo target", () => {
  const target = resolveSingleTarget({
    kind: "model",
    model: "claude/claude-opus-5-5",
    effort: "xhigh",
  });
  assert.equal(target.effort, "xhigh");
});

test("a step with no effort resolves a target with no effort key", () => {
  const target = resolveSingleTarget({ kind: "model", model: "claude/claude-opus-5-5" });
  assert.equal("effort" in target, false);
});

test("an invalid persisted effort never reaches the target", () => {
  const target = resolveSingleTarget({
    kind: "model",
    model: "claude/claude-opus-5-5",
    effort: "ultra",
  });
  assert.equal("effort" in target, false);
});

test("the pin is written onto the attempt body as output_config.effort", () => {
  const body = { model: "claude/claude-opus-5-5", messages: [] };
  const next = applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal((next.output_config as Record<string, unknown>).effort, "max");
});

test("the pin never writes a top-level reasoning_effort upstream", () => {
  const body = { model: "claude/claude-opus-5-5", messages: [] };
  const next = applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal("reasoning_effort" in next, false);
});

test("the pin strips a caller-supplied top-level reasoning_effort", () => {
  const body = { model: "claude/claude-opus-5-5", reasoning_effort: "low" };
  const next = applyComboTargetEffortPin(body, pinnedTarget("xhigh"));
  assert.equal((next.output_config as Record<string, unknown>).effort, "xhigh");
  assert.equal("reasoning_effort" in next, false);
});

test("the pin outranks a caller-supplied output_config.effort (S1)", () => {
  const body = { model: "claude/claude-opus-5-5", output_config: { effort: "low" } };
  const next = applyComboTargetEffortPin(body, pinnedTarget("xhigh"));
  assert.equal((next.output_config as Record<string, unknown>).effort, "xhigh");
});

test("the pin reaches a Sonnet 5.5 target the same way (S2)", () => {
  const target = {
    kind: "model",
    modelStr: "claude/claude-sonnet-5-5",
    effort: "max",
  } as never;
  const next = applyComboTargetEffortPin({ model: "claude/claude-sonnet-5-5" }, target);
  assert.equal((next.output_config as Record<string, unknown>).effort, "max");
  assert.equal("reasoning_effort" in next, false);
});

test("the pin clears a conflicting caller reasoning.effort / output_config.effort (S3b)", () => {
  const body = {
    model: "claude/claude-opus-5-5",
    reasoning: { effort: "low", summary: "auto" },
    output_config: { effort: "low" },
  };
  const next = applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal((next.reasoning as Record<string, unknown>).effort, "max");
  // Unrelated sibling keys survive the rewrite.
  assert.equal((next.reasoning as Record<string, unknown>).summary, "auto");
  assert.equal((next.output_config as Record<string, unknown>).effort, "max");
  assert.equal("reasoning_effort" in next, false);
});

test("the pin never invents a reasoning container the caller did not send", () => {
  const body = { model: "claude/claude-opus-5-5" };
  const next = applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal("reasoning" in next, false);
});

test("sibling output_config keys survive the pin (S6 adaptive pairing)", () => {
  const body = {
    model: "claude/claude-opus-5-5",
    output_config: { effort: "medium", verbosity: "low" },
    thinking: { type: "adaptive" },
  };
  const next = applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal((next.output_config as Record<string, unknown>).effort, "max");
  assert.equal((next.output_config as Record<string, unknown>).verbosity, "low");
  assert.deepEqual(next.thinking, { type: "adaptive" });
});

test("a non-Claude target ignores the pin entirely (S5)", () => {
  const body = { model: "openai/gpt-5.4", output_config: { effort: "low" } };
  const before = JSON.stringify(body);
  const target = { kind: "model", modelStr: "openai/gpt-5.4", effort: "max" } as never;
  const next = applyComboTargetEffortPin(body, target);
  assert.equal(next, body, "a non-Claude target must not clone the body");
  assert.equal(JSON.stringify(next), before);
});

test("an unpinned target leaves the body byte-identical and un-cloned (S4)", () => {
  const body = { model: "claude/claude-opus-5-5", output_config: { effort: "low" } };
  const before = JSON.stringify(body);
  const next = applyComboTargetEffortPin(body, pinnedTarget());
  assert.equal(next, body, "no pin must not clone the body");
  assert.equal(JSON.stringify(next), before);
});

test("the pin never mutates the caller's body object", () => {
  const body = {
    model: "claude/claude-opus-5-5",
    reasoning_effort: "low",
    output_config: { effort: "low" },
  };
  applyComboTargetEffortPin(body, pinnedTarget("max"));
  assert.equal(body.reasoning_effort, "low");
  assert.equal(body.output_config.effort, "low");
});
