import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
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
 * Permanent one-time onboarding after sign-in.
 * The flow is suppressed forever for the account once either:
 * 1) localStorage miniport_onboarding_done_<userId> is true, or
 * 2) profiles.onboarding_completed is true.
 */
export function OnboardingGate({ userId, isDriver }: { userId: string; isDriver: boolean }) {
  const qc = useQueryClient();
  const consent = useQuery({
    queryKey: ["consent", userId, TERMS_VERSION],
    queryFn: () => hasCurrentConsent(userId),
    staleTime: Infinity,
  });
  const onboardingProfile = useQuery({
    queryKey: ["onboarding-profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", userId)
        .maybeSingle();
      if (error) throw error;
      return data?.onboarding_completed === true;
    },
    staleTime: Infinity,
  });
  const [agree, setAgree] = useState(false);
  const [saving, setSaving] = useState(false);
  const [permsDone, setPermsDone] = useState(false);
  const [record, setRecord] = useState<PermissionRecord>({});
  const [busy, setBusy] = useState<PermissionKey | null>(null);
  const [permissionIndex, setPermissionIndex] = useState(0);

  useEffect(() => {
    setPermsDone(permissionFlowDone(userId));
    const saved = loadPermissionRecord(userId);
    setRecord(saved);
    const firstPending = PERMISSIONS.findIndex((p) => !saved[p.key]);
    setPermissionIndex(firstPending >= 0 ? firstPending : PERMISSIONS.length);
  }, [userId]);

  const localOnboardingDone = permsDone;
  const accountOnboardingDone = onboardingProfile.data === true;
  const onboardingDone = localOnboardingDone || accountOnboardingDone;
  const dataReady = consent.isSuccess && onboardingProfile.isSuccess;
  const needsConsent = dataReady && consent.data === false;

  // First login: show consent, then the one-time permission flow.
  // If a policy version changes later, consent is shown again even when the
  // device onboarding was already completed.
  const open = dataReady && (needsConsent || (!onboardingDone && consent.data === true));

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
    if (outcome === "denied") {
      toast.error(
        "Permission not granted. Tap Retry to ask again, or use your browser/app settings to allow it.",
      );
    } else {
      const nextIndex = PERMISSIONS.findIndex((p, index) => index > permissionIndex && !next[p.key]);
      setPermissionIndex(nextIndex >= 0 ? nextIndex : PERMISSIONS.length);
    }
    if (outcome === "unsupported") {
      toast.info("This device or browser can't grant this permission. Continue to the next step.");
      const nextIndex = PERMISSIONS.findIndex((p, index) => index > permissionIndex && !next[p.key]);
      setPermissionIndex(nextIndex >= 0 ? nextIndex : PERMISSIONS.length);
    }
  };

  const finish = async () => {
    // Mark local state immediately so the modal cannot reopen during this session.
    markPermissionFlowDone(userId);
    setPermsDone(true);

    const { error } = await supabase
      .from("profiles")
      .update({ onboarding_completed: true })
      .eq("id", userId);

    if (error) {
      toast.error("Onboarding saved on this device, but account sync failed. Please try again.");
      return;
    }

    qc.setQueryData(["onboarding-profile", userId], true);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={() => {
        // Permission onboarding is one-time and can only be completed with Done.
      }}
    >
      <DialogContent
        className="max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
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
            {permissionIndex < PERMISSIONS.length ? (
              (() => {
                const p = PERMISSIONS[permissionIndex];
                const Icon = ICONS[p.key];
                const outcome = record[p.key];
                return (
                  <div className="space-y-3">
                    <div className="rounded-md border p-4">
                      <div className="flex items-start gap-3">
                        <Icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-secondary">
                            {permissionIndex + 1}. {p.label}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {isDriver ? p.driverReason : p.reason}
                          </p>
                        </div>
                      </div>
                      {outcome === "denied" && (
                        <p className="mt-3 rounded-md bg-destructive/5 p-2 text-xs text-destructive">
                          Access was blocked. Tap Retry to request it again, or enable it in your
                          browser/app settings and then continue.
                        </p>
                      )}
                      {outcome === "unsupported" && (
                        <p className="mt-3 rounded-md bg-muted p-2 text-xs text-muted-foreground">
                          This permission is not available on this device/browser. Continue to
                          the next step.
                        </p>
                      )}
                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          disabled={busy !== null}
                          onClick={() => void ask(p.key)}
                        >
                          {busy === p.key ? "Asking…" : outcome === "denied" ? "Retry" : "Allow"}
                        </Button>
                        {outcome && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const nextIndex = PERMISSIONS.findIndex(
                                (nextPermission, index) =>
                                  index > permissionIndex && !record[nextPermission.key],
                              );
                              setPermissionIndex(nextIndex >= 0 ? nextIndex : PERMISSIONS.length);
                            }}
                          >
                            Continue
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()
            ) : (
              <div className="rounded-md border border-success/30 bg-success/5 p-3 text-sm text-success">
                All permission steps have been completed.
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Permissions are requested one at a time after login. Browsers share location only
              while MiniPort is open; background “Always allow” is controlled by the installed
              Android app settings where supported.
            </p>
            <Button onClick={() => void finish()} disabled={permissionIndex < PERMISSIONS.length}>
              Done
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
