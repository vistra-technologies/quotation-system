"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { LoadingOverlay } from "@/components/loading-overlay";
import { TrashIcon } from "@/components/trash-icon";
import { ItemFormModal } from "./_item-form-modal";
import type { ItemFormData, ComponentTypeOption } from "./_item-form-modal";
import { deleteInventoryItem } from "./actions";

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
  componentTypes: ComponentTypeOption[];
}

// ─── Delete button ────────────────────────────────────────────────────────────

/**
 * Per-row delete action for inventory items.
 *
 * Icon-only trash button opens a themed ConfirmDialog naming the item's
 * Code + Name. On confirmation, calls the deleteInventoryItem server action.
 *
 * Hotfix 2026-09-27 H-6.
 */
function DeleteInventoryItemButton({
  orgSlug,
  itemId,
  itemCode,
  itemName,
}: {
  orgSlug: string;
  itemId: string;
  itemCode: string;
  itemName: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function handleDeleteConfirm() {
    setIsConfirmOpen(false);
    setErrorMessage(null);
    const formData = new FormData();
    formData.set("orgSlug", orgSlug);
    formData.set("itemId", itemId);
    startTransition(async () => {
      try {
        await deleteInventoryItem(formData);
      } catch (err) {
        setErrorMessage(
          err instanceof Error ? err.message : "Delete failed — please try again.",
        );
      }
    });
  }

  return (
    <>
      <LoadingOverlay visible={isPending} />
      <ConfirmDialog
        isOpen={isConfirmOpen}
        title={`Delete ${itemCode}`}
        message={`Delete inventory item "${itemCode} — ${itemName}"? This cannot be undone.`}
        confirmLabel="Delete"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setIsConfirmOpen(false)}
        errorMessage={errorMessage}
      />
      <button
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={isPending}
        aria-label={`Delete item ${itemCode}`}
        title={`Delete item ${itemCode}`}
        className="flex h-7 w-7 items-center justify-center rounded-sm border border-border text-red-600 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
      >
        <TrashIcon />
      </button>
    </>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Interactive inventory list (Client Component).
 *
 * Renders the "Inventory Items" card with the table, the "New item" primary
 * button in the card header, and per-row Edit and Delete action buttons.
 * Manages modal open/close state and triggers `router.refresh()` after a
 * successful save so the parent Server Component re-fetches the updated list.
 *
 * Changes vs. original (hotfix 2026-09-27):
 *   H-3: Status (active/inactive) column removed entirely.
 *   H-5: "Category" column header renamed to "Component".
 *   H-6: Delete action added per row.
 */
export function InventoryList({ items, orgSlug, componentTypes }: InventoryListProps) {
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
      category: item.category,
      measurementUnit: item.measurementUnit,
      perUnitQuantity: item.perUnitQuantity,
    });
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setEditingItem(null);
  }

  function handleSuccess() {
    closeModal();
    router.refresh();
  }

  return (
    <>
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        {/* Card header */}
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
                {/* H-5: "Category" → "Component" */}
                <th className="px-5 py-3.5 text-xs font-bold uppercase tracking-wider text-text-muted">
                  Component
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
                {/* H-3: Status column removed */}
                {/* Actions column — no heading */}
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
                  {/* H-3: no Status cell */}
                  <td className="px-3 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-bg-white px-3 py-1.5 text-xs font-bold text-text-body hover:border-[#b9c2ae] hover:text-text-heading"
                      >
                        Edit
                      </button>
                      {/* H-6: delete action */}
                      <DeleteInventoryItemButton
                        orgSlug={orgSlug}
                        itemId={item.id}
                        itemCode={item.code}
                        itemName={item.name}
                      />
                    </div>
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
          componentTypes={componentTypes}
          onSuccess={handleSuccess}
          onClose={closeModal}
        />
      )}
    </>
  );
}
