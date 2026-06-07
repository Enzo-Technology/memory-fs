// The five memory-type accent colors from the Foundations visual system (fg + soft bg).
// One source so the list dots and the detail chip never drift. Quiet, muted hues so a long
// mixed list scans without fatigue.
import type { MemoryType } from "../../src/core/db";

export const TYPE_COLOR: Record<MemoryType, { fg: string; bg: string }> = {
  user: { fg: "#2F6BB0", bg: "#E9F0F8" },
  feedback: { fg: "#B07A1E", bg: "#F6EEDD" },
  project: { fg: "#2E7D7A", bg: "#E2F0EF" },
  reference: { fg: "#7A52B3", bg: "#EFE9F6" },
  note: { fg: "#6A6459", bg: "#F0EEE7" },
};
