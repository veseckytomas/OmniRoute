/**
 * Regression guard for the per-model Claude Code default effort.
 *
 * base.ts used to force `output_config = { effort: "high" }` for every model on the
 * native Claude Code wire image. The shipped Claude Code CLI instead resolves a
 * per-model `default_effort` from its model catalog and only falls back to "high"
 * when the model carries no explicit value.
 *
 * These cases pin the three distinct branches so a regression that drops
 * `defaultOutputEffort` from a ModelSpec (or reverts the injection to a literal)
 * fails here instead of silently shipping the wrong effort upstream.
 *
 * Harness mirrors tests/unit/base-thinking-budget-config-5312.test.ts, but is
 * parameterized by model id because that is exactly what is under test.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { BaseExecutor } from "../../open-sse/executors/base.ts";
import { getDefaultOutputEffort } from "../../src/shared/constants/modelSpecs.ts";
import {
  setThinkingBudgetConfig,
  DEFAULT_THINKING_CONFIG,
} from "../../open-sse/services/thinkingBudget.ts";

class ClaudeLikeExecutor extends BaseExecutor {
  constructor() {
    super("claude", { baseUrls: ["https://api.anthropic.com/v1/messages"] });
  }
  needsRefresh() {
    return false;
  }
  async transformRequest(_model: string, body: Record<string, unknown>) {
    return { ...body };
  }
}

async function captureUpstreamBody(
  model: string,
  extraHeaders: Record<string, string> = {}
): Promise<Record<string, unknown>> {
  const executor = new ClaudeLikeExecutor();
  const originalFetch = globalThis.fetch;
  let upstreamBody: Record<string, unknown> | null = null;
  globalThis.fetch = async (_url: string | URL | Request, init: RequestInit = {}) => {
    upstreamBody = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    await executor.execute({
      model,
      body: { model, messages: [{ role: "user", content: "hi" }] },
      stream: false,
      credentials: { accessToken: "sk-ant-oat-test-default-effort" },
      // The default adaptive-thinking injection is gated behind a real Claude Code
      // client (#5480), so identify as one here.
      clientHeaders: { "x-app": "cli", ...extraHeaders },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(upstreamBody, "fetch must have been called");
  return upstreamBody!;
}

test.afterEach(() => {
  setThinkingBudgetConfig(DEFAULT_THINKING_CONFIG);
});

test("per-model default effort: a model with an explicit medium default_effort gets medium", async () => {
  const upstream = await captureUpstreamBody("claude-opus-5-5");
  assert.deepEqual(upstream.thinking, { type: "adaptive" });
  assert.deepEqual(
    upstream.output_config,
    { effort: "medium" },
    "claude-opus-5-5 carries default_effort 'medium' in the shipped CLI catalog"
  );
});

test("per-model default effort: a model with an explicit xhigh default_effort gets xhigh", async () => {
  const upstream = await captureUpstreamBody("claude-opus-4-7");
  assert.deepEqual(
    upstream.output_config,
    { effort: "xhigh" },
    "claude-opus-4-7 carries default_effort 'xhigh' in the shipped CLI catalog"
  );
});

test("per-model default effort: a model with no explicit default_effort falls back to high", async () => {
  const upstream = await captureUpstreamBody("claude-sonnet-5");
  assert.deepEqual(upstream.output_config, { effort: "high" });
});

test("per-model default effort: an unknown model falls back to high", async () => {
  const upstream = await captureUpstreamBody("totally-unknown-model-xyz");
  assert.deepEqual(
    upstream.output_config,
    { effort: "high" },
    "an unresolvable model must not throw or emit an undefined effort"
  );
});

test("per-model default effort: an explicit x-omniroute-effort header still wins", async () => {
  const upstream = await captureUpstreamBody("claude-opus-5-5", {
    "x-omniroute-effort": "low",
  });
  assert.deepEqual(
    upstream.output_config,
    { effort: "low" },
    "the operator's explicit header must override the per-model default"
  );
});

test("getDefaultOutputEffort resolves the catalog and degrades to high", () => {
  assert.equal(getDefaultOutputEffort("claude-opus-4-7"), "xhigh");
  assert.equal(getDefaultOutputEffort("claude-opus-5-5"), "medium");
  assert.equal(getDefaultOutputEffort("claude-sonnet-5-5"), "medium");
  assert.equal(getDefaultOutputEffort("claude-sonnet-5"), "high");
  assert.equal(getDefaultOutputEffort("not-a-real-model"), "high");
  assert.equal(getDefaultOutputEffort(""), "high");
  assert.equal(getDefaultOutputEffort(null), "high");
  assert.equal(getDefaultOutputEffort(undefined), "high");
});
