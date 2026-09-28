-- Hotfix 2026-09-28 U-2: align InventoryItem units with the formula engine's vocabulary.
-- H-4's dropdown stored "m" / "piece"; formulas declare "metres" / "pieces" and the resolver
-- hard-matches the two (UNIT_MISMATCH). Data-only; other legacy values (m², mm, ft, set) are left
-- as-is because they have no safe mapping — the Inventory modal flags them "(unsupported)".
UPDATE "InventoryItem" SET "measurementUnit" = 'metres' WHERE "measurementUnit" = 'm';
UPDATE "InventoryItem" SET "measurementUnit" = 'pieces' WHERE "measurementUnit" = 'piece';
