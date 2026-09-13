import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Notification = {
  id: string;
  title: string;
  body: string;
  kind: string;
  read_at: string | null;
  created_at: string;
};

/** Announcements and trip updates sent to this person, newest first. */
export function NotificationsCard() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ["notifications", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, title, body, kind, read_at, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as Notification[];
    },
  });

  const unread = (list.data ?? []).filter((n) => !n.read_at);

  const markRead = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await supabase
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .in("id", ids);
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications", user?.id] }),
  });

  return (
    <section className="surface-card p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-display text-xl tracking-wide text-secondary">
          <Bell className="h-4 w-4 text-primary" /> Notifications
          {unread.length > 0 && (
            <Badge className="bg-primary text-primary-foreground">{unread.length} new</Badge>
          )}
        </h2>
        {unread.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={markRead.isPending}
            onClick={() => markRead.mutate(unread.map((n) => n.id))}
          >
            {markRead.isPending ? "Marking…" : "Mark all read"}
          </Button>
        )}
      </div>

      {list.isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
      ) : list.isError ? (
        <div className="text-center text-sm">
          <p className="text-muted-foreground">Could not load your notifications.</p>
          <Button size="sm" variant="outline" className="mt-2" onClick={() => list.refetch()}>
            Retry
          </Button>
        </div>
      ) : (list.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing here yet. Offers and trip updates will show up here.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {(list.data ?? []).map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <p
                  className={`text-sm ${n.read_at ? "font-medium text-secondary" : "font-semibold text-secondary"}`}
                >
                  {n.title}
                </p>
                {!n.read_at && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />}
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {new Date(n.created_at).toLocaleString("en-IN", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
