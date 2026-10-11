import {
  splitClaudeEffortSuffix,
  supportsClaudeMaxEffort,
  supportsXHighEffort,
} from "@omniroute/open-sse/config/providerModels.ts";
import {
  claudeEffortLevelsFor,
  formatClaudeEffortLabel,
  isKnownClaudeEffortBaseModel,
} from "@omniroute/open-sse/utils/claudeEffortVariants.ts";
import { COMBO_STEP_EFFORT_VALUES, type ComboStep, type ComboStepEffort } from "@/lib/combos/steps";

type Translate = (key: string, fallback: string) => string;

type BuilderModelLike = {
  id?: unknown;
  qualifiedModel?: unknown;
  supportedThinkingEfforts?: unknown;
};

type BuilderProviderLike = {
  providerId?: unknown;
  alias?: unknown;
  prefix?: unknown;
  models?: BuilderModelLike[];
};

const PINNABLE: readonly string[] = COMBO_STEP_EFFORT_VALUES;

function isPinnable(level: unknown): level is ComboStepEffort {
  return typeof level === "string" && PINNABLE.includes(level.toLowerCase());
}

/** Split `<provider>/<model>` into its parts; unqualified ids get an empty provider. */
function splitQualified(model: string): { providerId: string; modelId: string } {
  const slash = model.indexOf("/");
  return slash > 0
    ? { providerId: model.slice(0, slash), modelId: model.slice(slash + 1) }
    : { providerId: "", modelId: model };
}

function findProviderModelMetadata(
  builderProviders: BuilderProviderLike[] | undefined,
  providerId: string,
  modelId: string
): BuilderModelLike | undefined {
  const provider = (builderProviders || []).find(
    (candidate) =>
      candidate?.providerId === providerId ||
      candidate?.alias === providerId ||
      candidate?.prefix === providerId
  );
  return (provider?.models || []).find((model) => model?.id === modelId);
}

/**
 * Effort levels selectable for a combo target, in canonical order.
 *
 * The selected model's `supportedThinkingEfforts` metadata wins when present;
 * otherwise an effort-capable Claude-family model falls back to the registry
 * helpers (`supportsXHighEffort` / `supportsClaudeMaxEffort`). Anything else
 * returns an empty list, which hides the selector entirely. The model id is
 * stripped of a trailing `-<level>` variant suffix first, so pinning an effort
 * on e.g. `claude/claude-opus-4-7-max` still resolves the base model's levels.
 */
export function resolveComboTargetEffortLevels(
  entry: ComboStep | { kind?: string; model?: unknown } | null | undefined,
  builderProviders?: BuilderProviderLike[]
): ComboStepEffort[] {
  if (!entry || (entry.kind && entry.kind !== "model")) return [];
  const qualified = typeof entry.model === "string" ? entry.model.trim() : "";
  if (!qualified) return [];

  const { providerId, modelId } = splitQualified(qualified);
  const metadata = findProviderModelMetadata(builderProviders, providerId, modelId);
  if (Array.isArray(metadata?.supportedThinkingEfforts)) {
    const levels = metadata.supportedThinkingEfforts
      .map((level) => (typeof level === "string" ? level.toLowerCase() : ""))
      .filter(isPinnable);
    if (levels.length > 0) {
      return PINNABLE.filter((level) => levels.includes(level)) as ComboStepEffort[];
    }
  }

  const baseModel = splitClaudeEffortSuffix(modelId).baseModel;
  if (!isKnownClaudeEffortBaseModel(baseModel)) return [];

  const levels = claudeEffortLevelsFor(providerId, baseModel).filter(isPinnable);
  if (supportsXHighEffort(providerId, baseModel) && !levels.includes("xhigh")) {
    levels.push("xhigh");
  }
  if (supportsClaudeMaxEffort(baseModel)) levels.push("max");
  return PINNABLE.filter((level) => levels.includes(level)) as ComboStepEffort[];
}

/** Set (or clear, with an empty value) the pinned effort on one target. */
export function setComboTargetEffort(
  entries: ComboStep[],
  index: number,
  effort: string
): ComboStep[] {
  const selected = entries[index];
  if (!selected || selected.kind !== "model") return entries;
  const next = [...entries];
  const { effort: _removed, ...rest } = selected;
  next[index] = isPinnable(effort) ? { ...rest, effort } : rest;
  return next;
}

type Props = {
  entry: ComboStep;
  index: number;
  builderProviders?: BuilderProviderLike[];
  translate: Translate;
  onEffortChange: (index: number, effort: string) => void;
};

/**
 * Per-target reasoning-effort pin. Renders nothing for targets whose model has
 * no effort levels. The empty option means "no pin — the caller decides".
 */
export function ComboTargetEffortSelect({
  entry,
  index,
  builderProviders,
  translate,
  onEffortChange,
}: Props) {
  const levels = resolveComboTargetEffortLevels(entry, builderProviders);
  if (levels.length === 0) return null;

  const value = entry.kind === "model" && isPinnable(entry.effort) ? entry.effort : "";

  return (
    <select
      value={value}
      onChange={(event) => onEffortChange(index, event.target.value)}
      aria-label={translate("targetEffort", "Effort")}
      title={translate("targetEffortHelp", "Pin a reasoning effort for this target")}
      className="shrink-0 text-[10px] py-0.5 px-1 rounded border border-black/10 dark:border-white/10 bg-transparent text-text-muted focus:border-primary focus:outline-none"
    >
      <option value="">{translate("targetEffortNone", "Effort")}</option>
      {levels.map((level) => (
        <option key={level} value={level}>
          {formatClaudeEffortLabel(level)}
        </option>
      ))}
    </select>
  );
}
