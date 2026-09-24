"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ItemFormModal } from "./_item-form-modal";
import type { ItemFormData } from "./_item-form-modal";

// ─── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by GET /api/v1/orgs/[orgSlug]/inventory (JSON-serialised). */
export interface InventoryItemRow {
  id: string;
  category: string;
  code: string;
  name: string;
  measurementUnit: string;
  /** Prisma Decimal serialises as a string via JSON; treat as displayable. */
  perUnitQuantity: string | number;
  active: boolean;
}

interface InventoryListProps {
  items: InventoryItemRow[];
  orgSlug: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Interactive inventory list (Client Component).
 *
 * Renders the "Inventory Items" card with the table, the "New item" primary
 * button in the card header, and per-row "Edit" action buttons. Manages modal
 * open/close state and triggers `router.refresh()` after a successful save so
 * the parent Server Component re-fetches the updated list from the API.
 *
 * Stage 25 Batch 8.
 */
export function InventoryList({ items, orgSlug }: InventoryListProps) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemFormData | null>(null);

  function openCreate() {
    setEditingItem(null);
    setModalOpen(true);
  }

  function openEdit(item: InventoryItemRow) {
    setEditingItem({
      id: item.id,
      code: item.code,
      name: item.name,
      measurementUnit: item.measurementUnit,
      perUnitQuantity: item.perUnitQuantity,
      active: item.active,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingItem(null);
  }

  function handleSuccess() {
    closeModal();
    // Re-run the Server Component to re-fetch the updated list.
    router.refresh();
  }

  return (
    <>
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        {/* Card header — "Inventory Items" heading + item count pill + "New item" button */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="flex items-center gap-2.5">
            <h2 className="text-sm font-bold text-text-body">
              Inventory Items
            </h2>
            <span className="rounded-full bg-border px-2.5 py-0.5 text-xs font-bold text-text-muted">
              {items.length}
            </span>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-sm border border-primary-dark bg-primary px-3.5 py-2 text-xs font-extrabold text-white hover:bg-primary-dark"
          >
            <svg
              viewBox="0 0 12 12"
              fill="none"
              className="h-3 w-3"
              aria-hidden="true"
            >
              <path
                d="M6 1v10M1 6h10"
                stroke="white"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
            New item
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Category
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Code
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Name
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Unit of measure
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Qty / unit
                </th>
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Status
                </th>
                {/* Actions column — no heading per mockup */}
                <th className="px-5 py-3.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {items.map((item) => (
                <tr key={item.id} className="hover:bg-primary-softer/40">
                  <td className="px-5 py-4 font-mono text-xs text-text-muted">
                    {item.category}
                  </td>
                  <td className="px-5 py-4 font-mono text-xs text-text-muted">
                    {item.code}
                  </td>
                  <td className="px-5 py-4 font-semibold text-text-heading">
                    {item.name}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {item.measurementUnit}
                  </td>
                  <td className="px-5 py-4 text-text-body">
                    {item.perUnitQuantity}
                  </td>
                  <td className="px-5 py-4">
                    {item.active ? (
                      <span className="inline-flex items-center rounded-pill bg-status-paid-bg px-2.5 py-0.5 text-xs font-bold text-status-paid-text">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-pill bg-border px-2.5 py-0.5 text-xs font-bold text-text-muted">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-bg-white px-3 py-1.5 text-xs font-bold text-text-body hover:border-[#b9c2ae] hover:text-text-heading"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal — rendered outside the table so it overlays the full viewport */}
      {modalOpen && (
        <ItemFormModal
          mode={editingItem ? "edit" : "create"}
          item={editingItem ?? undefined}
          orgSlug={orgSlug}
          onSuccess={handleSuccess}
          onClose={closeModal}
        />
      )}
    </>
  );
}
