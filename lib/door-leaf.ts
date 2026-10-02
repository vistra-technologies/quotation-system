/**
 * Double-leaf detection for DOOR selections (Hotfix 2026-10-01 H-2/H-3).
 *
 * The org's DOOR ComponentType carries an optional Advanced dropdown `isDoubleLeaf` (Yes/No).
 * Only an explicit "Yes" means double leaf; blank, "No", a missing field, or any other value is a
 * single leaf. Pure and shared by the Design canvas (client) and the Summary computation (server).
 */
export const DOUBLE_LEAF_FIELD_KEY = "isDoubleLeaf";

export function isDoubleLeafConfig(config: Record<string, unknown> | null | undefined): boolean {
  return config?.[DOUBLE_LEAF_FIELD_KEY] === "Yes";
}
