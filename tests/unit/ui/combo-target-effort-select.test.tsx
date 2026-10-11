// @vitest-environment jsdom
// Per-target Effort pin in the combo create/edit form
// (src/app/(dashboard)/dashboard/combos/ComboTargetEffortSelect.tsx).
//
// Covers: level resolution from `supportedThinkingEfforts` metadata, the Claude
// registry fallback, hiding the selector for non-effort models, the empty
// "no pin" default, and the models[] write/clear round-trip.
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComboTargetEffortSelect,
  resolveComboTargetEffortLevels,
  setComboTargetEffort,
} from "@/app/(dashboard)/dashboard/combos/ComboTargetEffortSelect";
import type { ComboStep } from "@/lib/combos/steps";

const model = (name: string, effort?: string): ComboStep =>
  ({ kind: "model", model: name, ...(effort ? { effort } : {}) }) as ComboStep;

const containers: Array<{ root: ReturnType<typeof createRoot>; element: HTMLDivElement }> = [];

function renderSelect(entry: ComboStep, builderProviders?: any[]) {
  const element = document.createElement("div");
  document.body.appendChild(element);
  const root = createRoot(element);
  act(() => {
    root.render(
      <ComboTargetEffortSelect
        entry={entry}
        index={0}
        builderProviders={builderProviders}
        translate={(_key, fallback) => fallback}
        onEffortChange={vi.fn()}
      />
    );
  });
  containers.push({ root, element });
  return element;
}

afterEach(() => {
  for (const { root, element } of containers.splice(0)) {
    act(() => root.unmount());
    element.remove();
  }
});

describe("resolveComboTargetEffortLevels", () => {
  it("uses the selected model's supportedThinkingEfforts metadata when present", () => {
    const providers = [
      {
        providerId: "claude",
        models: [{ id: "claude-opus-4-7", supportedThinkingEfforts: ["high", "low", "max"] }],
      },
    ];
    // Canonical order, not the metadata's order.
    expect(resolveComboTargetEffortLevels(model("claude/claude-opus-4-7"), providers)).toEqual([
      "low",
      "high",
      "max",
    ]);
  });

  it("drops non-pinnable levels (none) from the metadata", () => {
    const providers = [
      {
        providerId: "claude",
        models: [{ id: "claude-opus-4-7", supportedThinkingEfforts: ["none", "low", "high"] }],
      },
    ];
    const levels = resolveComboTargetEffortLevels(model("claude/claude-opus-4-7"), providers);
    expect(levels).not.toContain("none");
    expect(levels).toEqual(["low", "high"]);
  });

  it("falls back to the registry for a Claude model without metadata", () => {
    const levels = resolveComboTargetEffortLevels(model("claude/claude-opus-4-7"), []);
    expect(levels).toContain("low");
    expect(levels).toContain("medium");
    expect(levels).toContain("high");
  });

  it("resolves base-model levels for an existing -max effort variant id", () => {
    const base = resolveComboTargetEffortLevels(model("claude/claude-opus-4-7"), []);
    expect(resolveComboTargetEffortLevels(model("claude/claude-opus-4-7-max"), [])).toEqual(base);
  });

  it("returns no levels for a non-effort model, a combo-ref, or an empty model", () => {
    expect(resolveComboTargetEffortLevels(model("openai/gpt-4o-mini"), [])).toEqual([]);
    expect(
      resolveComboTargetEffortLevels({ kind: "combo-ref", comboName: "child" } as ComboStep, [])
    ).toEqual([]);
    expect(resolveComboTargetEffortLevels(model(""), [])).toEqual([]);
  });
});

describe("setComboTargetEffort", () => {
  it("writes the chosen effort onto the models[] entry", () => {
    const next = setComboTargetEffort([model("claude/claude-opus-4-7")], 0, "high");
    expect(next[0]).toMatchObject({
      kind: "model",
      model: "claude/claude-opus-4-7",
      effort: "high",
    });
  });

  it("clears the pin on the empty choice and ignores unknown levels", () => {
    const pinned = [model("claude/claude-opus-4-7", "high")];
    expect(setComboTargetEffort(pinned, 0, "")[0]).not.toHaveProperty("effort");
    expect(setComboTargetEffort(pinned, 0, "none")[0]).not.toHaveProperty("effort");
    expect(setComboTargetEffort(pinned, 0, "bogus")[0]).not.toHaveProperty("effort");
  });

  it("leaves non-model steps untouched", () => {
    const entries = [{ kind: "combo-ref", comboName: "child" } as ComboStep];
    expect(setComboTargetEffort(entries, 0, "high")).toBe(entries);
    expect(setComboTargetEffort(entries, 5, "high")).toBe(entries);
  });
});

describe("<ComboTargetEffortSelect />", () => {
  it("renders nothing for a model with no effort levels", () => {
    expect(renderSelect(model("openai/gpt-4o-mini"), []).querySelector("select")).toBeNull();
  });

  it("defaults to the empty no-pin option", () => {
    const select = renderSelect(model("claude/claude-opus-4-7"), []).querySelector("select");
    expect(select).not.toBeNull();
    expect(select!.value).toBe("");
  });

  it("round-trips a previously saved effort back into the selector", () => {
    const select = renderSelect(model("claude/claude-opus-4-7", "high"), []).querySelector(
      "select"
    );
    expect(select!.value).toBe("high");
  });

  it("offers exactly the resolved levels plus the empty option", () => {
    const providers = [
      {
        providerId: "claude",
        models: [{ id: "claude-opus-4-7", supportedThinkingEfforts: ["low", "high", "max"] }],
      },
    ];
    const select = renderSelect(model("claude/claude-opus-4-7"), providers).querySelector("select");
    const values = Array.from(select!.querySelectorAll("option")).map((o) => o.value);
    expect(values).toEqual(["", "low", "high", "max"]);
  });
});
