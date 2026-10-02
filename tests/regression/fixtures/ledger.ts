import fs from "node:fs";
import path from "node:path";

export type LedgerKind =
  | "superadmin" | "project" | "inquiry" | "inventoryItem" | "externalCompany"
  | "user" | "role" | "org" | "formulaSet" | "componentType";

export interface LedgerEntry {
  kind: LedgerKind;
  id: string;
  orgSlug: string | null;
  label: string;
  createdAt: string;
}

/** Children before parents. A project cascades floors/rooms/partitions/selections/calculations. */
export const DELETE_ORDER: LedgerKind[] = [
  "project", "inquiry", "inventoryItem", "user", "externalCompany", "role",
  "componentType", "formulaSet", "superadmin", "org",
];

export class Ledger {
  private entries: LedgerEntry[] = [];
  constructor(private readonly file: string) {
    this.entries = this.read();
  }
  private read(): LedgerEntry[] {
    try { return JSON.parse(fs.readFileSync(this.file, "utf-8")) as LedgerEntry[]; } catch { return []; }
  }
  /** Re-read from disk (picks up entries other workers added). */
  load(): LedgerEntry[] { this.entries = this.read(); return this.entries; }
  all(): LedgerEntry[] { return this.entries; }
  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.entries, null, 2));
  }
  /** Must be called the moment a row is created — before any assertion on it. */
  add(e: Omit<LedgerEntry, "createdAt">): void {
    if (!e.label.startsWith("rgr-")) {
      throw new Error(`ledger: label "${e.label}" lacks the rgr- prefix — it could not be swept later`);
    }
    this.load(); // merge with other workers' entries before writing
    this.entries.push({ ...e, createdAt: new Date().toISOString() });
    this.persist();
  }
  remove(id: string): void {
    this.load();
    this.entries = this.entries.filter((e) => e.id !== id);
    this.persist();
  }
  inDeleteOrder(): LedgerEntry[] {
    return [...this.load()].sort(
      (a, b) => DELETE_ORDER.indexOf(a.kind) - DELETE_ORDER.indexOf(b.kind),
    );
  }
}
