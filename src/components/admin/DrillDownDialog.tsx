import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

export type DrillDownColumn<T> = {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
};

interface DrillDownDialogProps<T> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  rows: T[];
  columns: DrillDownColumn<T>[];
  searchFn?: (row: T, query: string) => boolean;
  emptyLabel?: string;
}

export function DrillDownDialog<T>({
  open, onOpenChange, title, description, rows, columns, searchFn, emptyLabel,
}: DrillDownDialogProps<T>) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim()) return rows;
    if (searchFn) return rows.filter((r) => searchFn(r, q));
    return rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q.toLowerCase()));
  }, [rows, q, searchFn]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <ScrollArea className="h-[60vh]">
          <div className="divide-y divide-border pr-2">
            {filtered.length === 0 && (
              <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                {emptyLabel ?? "No matching records."}
              </p>
            )}
            {filtered.map((row, i) => (
              <div key={i} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="min-w-0 space-y-0.5">
                  {columns.slice(0, -1).map((c) => (
                    <div key={c.key} className={c.className}>{c.render(row)}</div>
                  ))}
                </div>
                {columns.length > 0 && (
                  <div className={columns[columns.length - 1].className ?? "text-right font-display text-lg text-secondary"}>
                    {columns[columns.length - 1].render(row)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">{filtered.length} of {rows.length} records</p>
      </DialogContent>
    </Dialog>
  );
}
