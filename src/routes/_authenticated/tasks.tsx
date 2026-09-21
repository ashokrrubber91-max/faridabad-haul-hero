import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ListTodo, MessageCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/tasks")({
  head: () => ({
    meta: [
      { title: "My tasks · MiniPort" },
      {
        name: "description",
        content:
          "Tasks created from WhatsApp messages and the MiniPort ops console — pickups to remember, documents to check and follow-ups.",
      },
      { property: "og:title", content: "My tasks · MiniPort" },
      {
        property: "og:description",
        content: "WhatsApp and ops tasks for MiniPort drivers and the Faridabad ops team.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: TasksPage,
});

type Task = {
  id: string;
  scope: string;
  title: string;
  details: string | null;
  status: string;
  priority: string;
  source: string;
  due_at: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

function TasksPage() {
  const queryClient = useQueryClient();

  const tasks = useQuery({
    queryKey: ["ops-tasks"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ops_tasks")
        .select("id, scope, title, details, status, priority, source, due_at, created_at")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as Task[];
    },
  });

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.rpc("ops_task_set_status", { _id: id, _status: status });
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ops-tasks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const open = (tasks.data ?? []).filter((t) => t.status === "open" || t.status === "in_progress");
  const closed = (tasks.data ?? []).filter((t) => t.status === "done" || t.status === "cancelled");

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 pb-24">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-semibold text-secondary">
          <ListTodo className="h-5 w-5 text-primary" /> My tasks
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anything you send on WhatsApp as a note or reminder appears here.
        </p>
      </header>

      {tasks.isLoading && <p className="text-sm text-muted-foreground">Loading tasks…</p>}

      {tasks.isError && (
        <Card>
          <CardContent className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-muted-foreground">Could not load your tasks.</p>
            <Button size="sm" variant="outline" onClick={() => void tasks.refetch()}>
              <RefreshCw className="h-3.5 w-3.5" /> Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {tasks.isSuccess && open.length === 0 && closed.length === 0 && (
        <Card>
          <CardContent className="py-6 text-sm text-muted-foreground">
            No tasks yet. Send MiniPort a WhatsApp message like “Kal subah 8 baje Sector 21 se
            parcel uthana hai” and it will be saved here.
          </CardContent>
        </Card>
      )}

      {open.length > 0 && (
        <div className="space-y-3">
          {open.map((task) => (
            <Card key={task.id}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-start justify-between gap-2 text-base">
                  <span className="min-w-0 flex-1">{task.title}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {task.priority === "high" && <Badge variant="destructive">High</Badge>}
                    <Badge variant="secondary">{STATUS_LABEL[task.status] ?? task.status}</Badge>
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {task.details && task.details !== task.title && (
                  <p className="whitespace-pre-line text-sm text-muted-foreground">
                    {task.details}
                  </p>
                )}
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {task.source === "whatsapp" && <MessageCircle className="h-3.5 w-3.5" />}
                  {task.source === "whatsapp" ? "From WhatsApp" : "Created in MiniPort"}
                  {task.due_at
                    ? ` · due ${new Date(task.due_at).toLocaleString("en-IN", {
                        timeZone: "Asia/Kolkata",
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}`
                    : ""}
                </p>
                <div className="flex gap-2">
                  {task.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: task.id, status: "in_progress" })}
                    >
                      Start
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate({ id: task.id, status: "done" })}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Mark done
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-secondary">Finished</h2>
          <div className="space-y-2">
            {closed.slice(0, 20).map((task) => (
              <div key={task.id} className="rounded-md border p-3">
                <p className="text-sm text-secondary line-through">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {STATUS_LABEL[task.status] ?? task.status}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
