"use client";

import { type ReactNode } from "react";
import { Button } from "@/components/ui";
import { Field, inputClassName } from "./elements";

export type TableSort = { key: string; direction: "asc" | "desc" };
export type TableColumn = { key: string; label: string; sortable?: boolean; className?: string };

export function DataTableControls({ search, onSearch, searchLabel = "Search", placeholder, sort, sortOptions, onSort, children, onReset }: {
  search: string; onSearch: (value: string) => void; searchLabel?: string; placeholder?: string;
  sort: TableSort; sortOptions: Array<{ value: string; label: string }>; onSort: (value: TableSort) => void;
  children?: ReactNode; onReset: () => void;
}) {
  return <div className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3" aria-label="List controls">
    <Field label={searchLabel}><input className={inputClassName + " block w-full sm:w-56"} maxLength={100} value={search} placeholder={placeholder} onChange={event => onSearch(event.target.value)} /></Field>
    {children}
    <Field label="Sort by"><select className={inputClassName} value={sort.key} onChange={event => onSort({ ...sort, key: event.target.value })}>{sortOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></Field>
    <Field label="Order"><select className={inputClassName} value={sort.direction} onChange={event => onSort({ ...sort, direction: event.target.value as TableSort["direction"] })}><option value="asc">Ascending</option><option value="desc">Descending</option></select></Field>
    <Button variant="ghost" onClick={onReset}>Reset filters</Button>
  </div>;
}

export function DataTable({ caption, columns, sort, onSort, children }: { caption: string; columns: TableColumn[]; sort?: TableSort; onSort?: (value: TableSort) => void; children: ReactNode }) {
  return <div className="max-w-full overflow-x-auto"><table className="w-full table-fixed text-left text-sm sm:min-w-[760px]">
    <caption className="sr-only">{caption}</caption>
    <thead className="border-b border-[var(--border)] bg-[var(--surface-muted)]"><tr>{columns.map(column => <th key={column.key} scope="col" className={"px-3 py-3 font-medium sm:px-4 " + (column.className ?? "")} aria-sort={column.sortable && sort ? sort.key === column.key ? sort.direction === "asc" ? "ascending" : "descending" : "none" : undefined}>
      {column.sortable && onSort ? <button className="min-h-10 text-left underline decoration-dotted underline-offset-4" onClick={() => onSort({ key: column.key, direction: sort?.key === column.key && sort.direction === "asc" ? "desc" : "asc" })}>{column.label}{sort?.key === column.key ? sort.direction === "asc" ? " ↑" : " ↓" : ""}</button> : column.label}
    </th>)}</tr></thead><tbody className="divide-y divide-[var(--border)]">{children}</tbody>
  </table></div>;
}
