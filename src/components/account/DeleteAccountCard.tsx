import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ShieldAlert, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteMyAccount } from "@/lib/account.functions";
import { signOutEverywhere } from "@/lib/session";

/**
 * In-app account deletion (Google Play / App Store requirement). The public web
 * page at /delete-account.html stays available as the external path.
 */
export function DeleteAccountCard() {
  const qc = useQueryClient();
  const runDelete = useServerFn(deleteMyAccount);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await runDelete();
      toast.success("Your account has been deleted.");
      await signOutEverywhere(qc);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "We could not delete the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full justify-start border-destructive/30 text-destructive hover:bg-destructive/5"
        >
          <Trash2 className="h-4 w-4" /> Delete account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-destructive" /> Delete your MiniPort account
          </DialogTitle>
          <DialogDescription>
            This removes your name, mobile number, saved addresses, GST details, payout details,
            uploaded documents and notification settings, and signs you out everywhere. Completed
            trip and payment records are kept without your personal details because we are required
            to keep them for tax and dispute purposes. You cannot delete the account while a trip is
            still open — finish or cancel it first.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="del-confirm">Type DELETE to confirm</Label>
          <Input
            id="del-confirm"
            value={confirm}
            autoComplete="off"
            onChange={(e) => setConfirm(e.target.value.toUpperCase())}
            placeholder="DELETE"
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
            Keep my account
          </Button>
          <Button variant="destructive" onClick={submit} disabled={busy || confirm !== "DELETE"}>
            {busy ? "Deleting…" : "Delete account permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
