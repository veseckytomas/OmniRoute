/**
 * Combo model steps can pin a reasoning `effort` level (e.g. a Claude Code
 * effort level), persisted inside the combo's serialized `data` JSON.
 *
 * Coverage:
 *   1. normalizeComboStep preserves a valid `effort` on a model step.
 *   2. normalizeComboStep strips an invalid/absent `effort` (no throw).
 *   3. The create/update schemas accept the union and round-trip it unchanged.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createComboSchema, updateComboSchema } from "../../src/shared/validation/schemas/combo.ts";
import {
  COMBO_STEP_EFFORT_VALUES,
  normalizeComboStep,
  type ComboModelStep,
  type ComboStepEffort,
} from "../../src/lib/combos/steps.ts";

const baseStep = { kind: "model" as const, model: "openai/gpt-4o" };

function normalizeModel(value: unknown): ComboModelStep {
  const step = normalizeComboStep(value);
  assert.ok(step && step.kind === "model", "expected a normalized model step");
  return step;
}

test("normalizeComboStep preserves every valid effort level on a model step", () => {
  for (const effort of COMBO_STEP_EFFORT_VALUES) {
    assert.equal(normalizeModel({ ...baseStep, effort }).effort, effort);
  }
});

test("normalizeComboStep normalizes effort case-insensitively", () => {
  assert.equal(normalizeModel({ ...baseStep, effort: "  HIGH " }).effort, "high");
});

test("normalizeComboStep drops an invalid effort instead of throwing", () => {
  // "none" is canonical for reasoning requests but is NOT a pinnable step
  // effort — absence of a pin is how you express it.
  for (const bad of ["none", "ultra", "", "  ", 1, null, true, {}, ["high"]]) {
    const step = normalizeModel({ ...baseStep, effort: bad });
    assert.equal(step.effort, undefined, `expected ${JSON.stringify(bad)} to be dropped`);
    assert.equal("effort" in step, false, "invalid effort must omit the key entirely");
  }
});

test("normalizeComboStep omits the effort key when absent", () => {
  const step = normalizeModel(baseStep);
  assert.equal("effort" in step, false);
});

test("create/update schemas round-trip a valid effort and reject an invalid one", () => {
  const payload = {
    name: "effort-combo",
    strategy: "priority" as const,
    models: [{ ...baseStep, effort: "xhigh" as ComboStepEffort }],
  };

  assert.equal(createComboSchema.parse(payload).models[0].effort, "xhigh");
  assert.equal(updateComboSchema.parse(payload).models?.[0].effort, "xhigh");

  for (const bad of ["none", "ultra", 1, null]) {
    assert.equal(
      createComboSchema.safeParse({ ...payload, models: [{ ...baseStep, effort: bad }] }).success,
      false,
      `expected ${JSON.stringify(bad)} to be rejected by the schema`
    );
  }
});

test("a schema-validated step keeps its effort through normalization", () => {
  const parsed = createComboSchema.parse({
    name: "effort-combo",
    strategy: "priority" as const,
    models: [{ ...baseStep, effort: "max" as ComboStepEffort }],
  });
  assert.equal(normalizeModel(parsed.models[0]).effort, "max");
});
