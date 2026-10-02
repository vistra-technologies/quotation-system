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

type Op = { op: "add"; entry: LedgerEntry } | { op: "remove"; id: string };

/** Append-only JSONL: each add/remove is one appended line; load() folds the lines. */
export class Ledger {
  private entries: LedgerEntry[] = [];
  constructor(private readonly file: string) {
    this.entries = this.read();
  }
  private read(): LedgerEntry[] {
    let text: string;
    try {
      text = fs.readFileSync(this.file, "utf-8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const lines = text.split("\n");
    let last = lines.length - 1;
    while (last >= 0 && lines[last].trim() === "") last--;
    let entries: LedgerEntry[] = [];
    for (let i = 0; i <= last; i++) {
      if (lines[i].trim() === "") continue;
      let rec: Op;
      try {
        rec = JSON.parse(lines[i]) as Op;
      } catch {
        if (i === last) break; // crash mid-append: ignore the partial final line
        throw new Error(`ledger: ${this.file} line ${i + 1} is corrupt`);
      }
      if (rec.op === "add") entries = [...entries.filter((e) => e.id !== rec.entry.id), rec.entry];
      else if (rec.op === "remove") entries = entries.filter((e) => e.id !== rec.id);
      else throw new Error(`ledger: ${this.file} line ${i + 1} has an unknown op`);
    }
    return entries;
  }
  private append(rec: Op) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    try {
      const t = fs.readFileSync(this.file, "utf-8");
      if (t !== "" && !t.endsWith("\n")) {
        // a crash left a partial final line: drop it so the new record doesn't become a corrupt middle line
        fs.writeFileSync(this.file, t.slice(0, t.lastIndexOf("\n") + 1));
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    fs.appendFileSync(this.file, JSON.stringify(rec) + "\n");
  }
  /** Re-read from disk (picks up entries other workers added). */
  load(): LedgerEntry[] { this.entries = this.read(); return this.entries; }
  all(): LedgerEntry[] { return this.entries; }
  /** Must be called the moment a row is created — before any assertion on it. */
  add(e: Omit<LedgerEntry, "createdAt">): void {
    if (!e.label.startsWith("rgr-")) {
      throw new Error(`ledger: label "${e.label}" lacks the rgr- prefix — it could not be swept later`);
    }
    this.append({ op: "add", entry: { ...e, createdAt: new Date().toISOString() } });
    this.load();
  }
  remove(id: string): void {
    this.append({ op: "remove", id });
    this.load();
  }
  inDeleteOrder(): LedgerEntry[] {
    return [...this.load()].sort(
      (a, b) => DELETE_ORDER.indexOf(a.kind) - DELETE_ORDER.indexOf(b.kind),
    );
  }
}
