import { useQuery } from "@tanstack/react-query";
import { Building2 } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type CustomerGstin = {
  id: string;
  gstin: string;
  business_name: string;
  business_address: string | null;
  is_default: boolean;
};

export function GstinSelect({
  enabled,
  setEnabled,
  selectedId,
  setSelectedId,
}: {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
}) {
  const { user } = useAuth();

  const gstins = useQuery({
    queryKey: ["customer-gstins", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("customer_gstins")
        .select("*")
        .order("is_default", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CustomerGstin[];
    },
  });

  const rows = gstins.data ?? [];
  if (rows.length === 0) return null;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" /> Bill to a GSTIN (corporate)
        </Label>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => {
            setEnabled(v);
            if (v && !selectedId) {
              const def = rows.find((r) => r.is_default) ?? rows[0];
              setSelectedId(def.id);
            }
          }}
        />
      </div>
      {enabled && (
        <div className="mt-3 space-y-1.5">
          {rows.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => setSelectedId(g.id)}
              className={`flex w-full items-center justify-between rounded-md border p-2.5 text-left text-sm transition-colors ${
                selectedId === g.id ? "border-primary bg-accent" : "border-border hover:bg-muted"
              }`}
            >
              <div className="min-w-0">
                <p className="truncate font-medium text-secondary">{g.business_name}</p>
                <p className="truncate text-xs text-muted-foreground">{g.gstin}</p>
              </div>
              {g.is_default && <span className="shrink-0 text-[10px] text-muted-foreground">Default</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
