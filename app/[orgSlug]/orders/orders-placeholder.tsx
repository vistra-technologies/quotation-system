"use client";

import { Toast, useToast } from "@/components/toast";

/**
 * Orders placeholder page content (Client Component).
 *
 * Inert shell matching order-list-page.html. All interactive elements
 * (toolbar buttons, row actions, pagination) show the "Coming Soon" toast.
 * Static mock rows are used because no Order entity or DAL exists yet.
 *
 * Stage 10 — Task 1.8. Decision #4: Orders gets an inert placeholder route,
 * same concept as Stage 9's Summary/Quotation placeholders but with a richer
 * shell matching the approved mockup.
 */

// Static placeholder rows lifted from the order-list-page.html mockup.
const MOCK_ORDERS = [
  {
    id: "ORD-3311",
    name: "Website Revamp",
    createdBy: "Maren Feld",
    createdDate: "Jul 8",
    modifiedBy: "Priya Ramesh",
    modifiedDate: "Jul 8",
    status: "Paid" as const,
    total: "$1,240.00",
  },
  {
    id: "ORD-3310",
    name: "Mobile App Refresh",
    createdBy: "Devon Okafor",
    createdDate: "Jul 8",
    modifiedBy: "Noah Whitfield",
    modifiedDate: "Jul 9",
    status: "Pending" as const,
    total: "$89.50",
  },
  {
    id: "ORD-3309",
    name: "Q3 Campaign Assets",
    createdBy: "Priya Ramesh",
    createdDate: "Jul 7",
    modifiedBy: "Grace Nakamura",
    modifiedDate: "Jul 9",
    status: "Shipped" as const,
    total: "$452.00",
  },
] satisfies Array<{
  id: string;
  name: string;
  createdBy: string;
  createdDate: string;
  modifiedBy: string;
  modifiedDate: string;
  status: "Paid" | "Pending" | "Shipped" | "Failed" | "Refunded";
  total: string;
}>;

// Status badge styling uses Sage Ease status-pill tokens from globals.css.
const STATUS_STYLES: Record<string, string> = {
  Paid: "bg-status-paid-bg text-status-paid-text",
  Pending: "bg-status-pending-bg text-status-pending-text",
  Shipped: "bg-status-shipped-bg text-status-shipped-text",
  Failed: "bg-status-failed-bg text-status-failed-text",
  Refunded: "bg-status-refunded-bg text-status-refunded-text",
};

export function OrdersPlaceholder() {
  const toast = useToast();

  return (
    <>
      {/* Page title */}
      <h1 className="mb-[22px] text-[32px] font-extrabold text-text-heading">
        Orders
      </h1>

      {/* Toolbar */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
        {/* Left: date filter */}
        <button
          type="button"
          onClick={toast.show}
          className="flex items-center gap-2 rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-semibold text-text-body hover:bg-primary-softer"
        >
          All dates
          <svg
            className="h-3.5 w-3.5 text-text-muted"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {/* Right: search + action buttons */}
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            placeholder="Search..."
            onClick={toast.show}
            readOnly
            className="w-64 cursor-pointer rounded-sm border border-border bg-bg-white px-3.5 py-2.5 text-sm text-text-placeholder placeholder:text-text-placeholder focus:outline-none"
          />

          <button
            type="button"
            onClick={toast.show}
            className="rounded-sm bg-primary px-4 py-2.5 text-sm font-bold text-text-on-primary hover:bg-primary-dark"
          >
            + New Order
          </button>

          {/* Segmented control */}
          <div className="flex overflow-hidden rounded-sm border border-border bg-bg-white text-sm font-semibold">
            <button
              type="button"
              onClick={toast.show}
              className="border-r border-border px-4 py-2.5 text-text-muted hover:bg-primary-softer"
            >
              My Orders
            </button>
            <button
              type="button"
              onClick={toast.show}
              className="bg-primary-softer px-4 py-2.5 text-text-heading"
            >
              All Orders
            </button>
          </div>

          <button
            type="button"
            onClick={toast.show}
            className="rounded-sm border border-border bg-bg-white px-4 py-2.5 text-sm font-semibold text-text-body hover:bg-primary-softer"
          >
            Export Orders
          </button>
        </div>
      </div>

      {/* Orders table */}
      <div className="rounded-md border border-border bg-bg-card shadow-card">
        <div className="overflow-x-auto px-4 py-2">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-extrabold uppercase tracking-wide text-text-muted">
                <th className="w-7 py-3 pr-3">
                  <input
                    type="checkbox"
                    onClick={toast.show}
                    className="cursor-pointer"
                    readOnly
                  />
                </th>
                <th className="py-3 pr-4">Order ID</th>
                <th className="py-3 pr-4">Project Name</th>
                <th className="py-3 pr-4">Created By</th>
                <th className="py-3 pr-4">Created Date</th>
                <th className="py-3 pr-4">Modified By</th>
                <th className="py-3 pr-4">Modified Date</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Total</th>
                <th className="py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {MOCK_ORDERS.map((order) => (
                <tr
                  key={order.id}
                  className="text-text-body hover:bg-primary-softer"
                >
                  <td className="py-3.5 pr-3">
                    <input
                      type="checkbox"
                      onClick={toast.show}
                      className="cursor-pointer"
                      readOnly
                    />
                  </td>
                  <td className="py-3.5 pr-4 font-bold">{order.id}</td>
                  <td className="py-3.5 pr-4">{order.name}</td>
                  <td className="py-3.5 pr-4">{order.createdBy}</td>
                  <td className="py-3.5 pr-4 text-text-muted">
                    {order.createdDate}
                  </td>
                  <td className="py-3.5 pr-4">{order.modifiedBy}</td>
                  <td className="py-3.5 pr-4 text-text-muted">
                    {order.modifiedDate}
                  </td>
                  <td className="py-3.5 pr-4">
                    <span
                      className={`inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-bold ${STATUS_STYLES[order.status]}`}
                    >
                      {order.status}
                    </span>
                  </td>
                  <td className="py-3.5 pr-4 font-bold">{order.total}</td>
                  <td className="py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={toast.show}
                        title="Edit"
                        className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-primary-softer hover:text-primary-dark"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={toast.show}
                        title="Delete"
                        className="flex h-7 w-7 items-center justify-center rounded text-text-muted hover:bg-status-failed-bg hover:text-status-failed-text"
                      >
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polyline points="3 6 5 6 21 6" />
                          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Table footer */}
          <div className="flex items-center justify-between border-t border-border px-3 pt-[18px] pb-1">
            <span className="text-sm text-text-muted">Page 1 of 2</span>
            <div className="flex gap-1">
              <button
                type="button"
                onClick={toast.show}
                className="flex h-8 w-8 items-center justify-center rounded-sm bg-primary text-sm font-bold text-text-on-primary"
              >
                1
              </button>
              <button
                type="button"
                onClick={toast.show}
                className="flex h-8 w-8 items-center justify-center rounded-sm border border-border text-sm font-semibold text-text-body hover:bg-primary-softer"
              >
                2
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Coming Soon note */}
      <p className="mt-6 text-center text-sm text-text-muted">
        Orders — coming in a future stage
      </p>

      {/* Single toast instance shared by all interactions on this page */}
      <Toast {...toast} />
    </>
  );
}
