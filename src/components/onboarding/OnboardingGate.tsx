import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Bell, Camera, CheckCircle2, MapPin, Mic, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { hasCurrentConsent, recordConsent, TERMS_VERSION } from "@/lib/legal";
import {
  PERMISSIONS,
  type PermissionKey,
  type PermissionRecord,
  loadPermissionRecord,
  savePermissionRecord,
  requestPermission,
  permissionFlowDone,
  markPermissionFlowDone,
} from "@/lib/device-permissions";

const ICONS: Record<PermissionKey, typeof MapPin> = {
  location: MapPin,
  camera: Camera,
  microphone: Mic,
  notifications: Bell,
};

/**
 * One-time onboarding after sign-in: accept the current Terms/Privacy version
 * (stored server-side per account + version), then one permissions step whose
 * outcome is remembered on this device so it never nags.
 */
export function OnboardingGate({ userId, isDriver }: { userId: string; isDriver: boolean }) {
  const qc = useQueryClient();
  const consent = useQuery({
    queryKey: ["consent", userId, TERMS_VERSION],
    queryFn: () => hasCurrentConsent(userId),
    staleTime: Infinity,
  });
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permsDone, setPermsDone] = useState(true);
  const [record, setRecord] = useState<PermissionRecord>({});
  const [busy, setBusy] = useState<PermissionKey | null>(null);

  useEffect(() => {
    setPermsDone(permissionFlowDone(userId));
    setRecord(loadPermissionRecord(userId));
  }, [userId]);

  const needsConsent = consent.data === false;
  const open = needsConsent || (consent.data === true && !permsDone);

  const accept = async () => {
    setSaving(true);
    const ok = await recordConsent("login");
    setSaving(false);
    if (!ok) return toast.error("We could not save your acceptance. Please try again.");
    qc.setQueryData(["consent", userId, TERMS_VERSION], true);
  };

  const ask = async (key: PermissionKey) => {
    setBusy(key);
    const outcome = await requestPermission(key);
    setBusy(null);
    const next = { ...record, [key]: outcome };
    setRecord(next);
    savePermissionRecord(userId, next);
    if (outcome === "denied")
      toast.error(
        "Permission not granted. You can allow it later in your browser or app settings.",
      );
    if (outcome === "unsupported")
      toast.info("This device or browser can't grant this permission.");
  };

  const finish = () => {
    markPermissionFlowDone(userId);
    setPermsDone(true);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !needsConsent && finish()}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => needsConsent && e.preventDefault()}
        onEscapeKeyDown={(e) => needsConsent && e.preventDefault()}
      >
        {needsConsent ? (
          <>
            <DialogHeader>
              <DialogTitle>Terms &amp; Privacy Policy</DialogTitle>
              <DialogDescription>
                Please read and accept MiniPort's policies (version {TERMS_VERSION}) once for this
                account.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-4 text-sm">
              <a
                href="/terms.html"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline"
              >
                Terms &amp; Conditions
              </a>
              <a
                href="/privacy.html"
                target="_blank"
                rel="noreferrer"
                className="font-medium text-primary underline"
              >
                Privacy Policy
              </a>
            </div>
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                checked={agree}
                onCheckedChange={(v) => setAgree(v === true)}
                className="mt-0.5"
              />
              I have read and accept the Terms &amp; Conditions and Privacy Policy.
            </label>
            <Button onClick={() => void accept()} disabled={!agree || saving}>
              {saving ? "Saving…" : "Accept and continue"}
            </Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Allow app permissions</DialogTitle>
              <DialogDescription>
                MiniPort works best with these. Your device will ask you to confirm each one.
              </DialogDescription>
            </DialogHeader>
            <ul className="space-y-2">
              {PERMISSIONS.map((p) => {
                const Icon = ICONS[p.key];
                const outcome = record[p.key];
                return (
                  <li key={p.key} className="flex items-center gap-3 rounded-md border p-3">
                    <Icon className="h-5 w-5 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-secondary">{p.label}</p>
                      <p className="text-xs text-muted-foreground">
                        {isDriver ? p.driverReason : p.reason}
                      </p>
                    </div>
                    {outcome === "granted" ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-success">
                        <CheckCircle2 className="h-4 w-4" /> Allowed
                      </span>
                    ) : outcome ? (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <XCircle className="h-4 w-4" />
                        {outcome === "denied" ? "Blocked" : "Not available"}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => void ask(p.key)}
                      >
                        {busy === p.key ? "Asking…" : "Allow"}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="text-xs text-muted-foreground">
              Browsers share location only while MiniPort is open. “Always allow” background
              location is available only in the installed Android app's settings, where supported.
            </p>
            <Button onClick={finish}>Done</Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
