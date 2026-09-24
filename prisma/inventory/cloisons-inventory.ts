/**
 * Cloisons-specific InventoryItem definitions — Stage 24 Batch 3.
 *
 * 22 items: 3 glass profiles (metres, perUnitQuantity 3.0 = one 3000mm stock length),
 * 12 DOOR items, 7 GLASS connector/gasket/wedge items.
 *
 * perUnitQuantity values (flagged as D-1 in plan-b3.md — reviewer/human must confirm
 * before the production runbook runs):
 *   - 3.0 for structural profile items (DOOR-FRAME-01, DOOR-LEAF-01, I LUF-01, I10 PDL, I LUO-01)
 *     — consistent with the 3000 mm stock length hardcoded into `straightConnector`'s formula.
 *   - 1 for all gasket/rubber/wedge metres items and all pieces items (sold by the metre or unit).
 *
 * Pure data — no Prisma import, no side effects.
 */

export interface CloisonsInventoryItemDef {
  code: string;
  name: string;
  category: string;
  measurementUnit: string;
  perUnitQuantity: number;
  active: boolean;
}

export const CLOISONS_INVENTORY_DEFS: CloisonsInventoryItemDef[] = [
  // ── Glass profiles (3 items, GLASS slot — u_profile / i_profile / l_profile) ───────────────────
  {
    code: "I LUF-01",
    name: "U Profile",
    category: "GLASS_PROFILE",
    measurementUnit: "metres",
    perUnitQuantity: 3.0,
    active: true,
  },
  {
    code: "I10 PDL",
    name: "I Profile",
    category: "GLASS_PROFILE",
    measurementUnit: "metres",
    perUnitQuantity: 3.0,
    active: true,
  },
  {
    code: "I LUO-01",
    name: "L Profile",
    category: "GLASS_PROFILE",
    measurementUnit: "metres",
    perUnitQuantity: 3.0,
    active: true,
  },

  // ── DOOR items (12 items) ─────────────────────────────────────────────────────────────────────
  {
    code: "DOOR-FRAME-01",
    name: "Door Frame Profile",
    category: "DOOR_PROFILE",
    measurementUnit: "metres",
    perUnitQuantity: 3.0,
    active: true,
  },
  {
    code: "DOOR-LEAF-01",
    name: "Door Leaf Profile",
    category: "DOOR_PROFILE",
    measurementUnit: "metres",
    perUnitQuantity: 3.0,
    active: true,
  },
  {
    code: "DOOR-CCB-01",
    name: "Corner Connector (Big)",
    category: "DOOR_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-CCSF-01",
    name: "Corner Connector (Small, Frame)",
    category: "DOOR_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-CCSL-01",
    name: "Corner Connector (Small, Leaf)",
    category: "DOOR_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-LANG-01",
    name: "L Angle",
    category: "DOOR_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-HING-01",
    name: "Door Hinge",
    category: "DOOR_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-RUB25-01",
    name: "2.5mm Rubber Strip",
    category: "DOOR_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-FBGSK-01",
    name: "Frame Bumper Gasket",
    category: "DOOR_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-FBKGSK-01",
    name: "Frame Back Gasket",
    category: "DOOR_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-LGG1-01",
    name: "Leaf Glass Gasket 1",
    category: "DOOR_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "DOOR-LGG2-01",
    name: "Leaf Glass Gasket 2",
    category: "DOOR_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },

  // ── GLASS connector/gasket/wedge items (7 items) ──────────────────────────────────────────────
  {
    code: "GLASS-ACGSK-01",
    name: "Acoustic Gasket",
    category: "GLASS_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-WSEAL-01",
    name: "White Seal",
    category: "GLASS_GASKET",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-WWDG-01",
    name: "Wood Wedge",
    category: "GLASS_WEDGE",
    measurementUnit: "metres",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-LCON-01",
    name: "L Connector",
    category: "GLASS_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-DCON-01",
    name: "Degree Connector",
    category: "GLASS_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-DRCON-01",
    name: "Door Connector",
    category: "GLASS_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
  {
    code: "GLASS-STCON-01",
    name: "Straight Connector",
    category: "GLASS_CONNECTOR",
    measurementUnit: "pieces",
    perUnitQuantity: 1,
    active: true,
  },
];
