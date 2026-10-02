import { useState } from "react";
import { Camera, CheckCircle2, Loader2, PenLine, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SignaturePad } from "@/components/driver/SignaturePad";

type Props = {
  open: boolean;
  uploading?: boolean;
  photoReady: boolean;
  signatureReady: boolean;
  photoPath?: string | null;
  onClose: () => void;
  onPhoto: (file: File) => Promise<void>;
  onSignature: (blob: Blob | null) => void;
  onContinue: () => Promise<void>;
};

async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose an image");
  const bitmap = await createImageBitmap(file);
  const max = 1280;
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Image compression is not supported on this device");
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not compress photo"))), "image/jpeg", 0.78),
  );
  return new File([blob], "pod-" + Date.now() + ".jpg", { type: "image/jpeg" });
}

export function PODUploadModal(props: Props) {
  const [compressing, setCompressing] = useState(false);

  const choosePhoto = async (file: File) => {
    setCompressing(true);
    try {
      await props.onPhoto(await compressImage(file));
    } finally {
      setCompressing(false);
    }
  };

  const ready = props.photoReady && props.signatureReady;

  return (
    <Dialog open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PenLine className="h-5 w-5 text-primary" /> Proof of delivery</DialogTitle>
          <DialogDescription>Capture the delivery photo and receiver signature. Drop OTP unlocks only after both are complete.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border p-4">
            <Camera className="h-5 w-5 text-primary" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">Delivery photo</span>
              <span className="block text-xs text-muted-foreground">Compressed on the device before upload.</span>
            </span>
            {props.photoReady ? <CheckCircle2 className="h-5 w-5 text-success" /> : compressing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
            <input className="sr-only" type="file" accept="image/*" capture="environment" onChange={(e) => {
              const file = e.target.files?.[0];
              e.currentTarget.value = "";
              if (file) void choosePhoto(file).catch(() => undefined);
            }} />
          </label>
          {props.photoPath && <p className="text-xs text-success">Photo uploaded securely.</p>}
          <div className="rounded-lg border p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold"><PenLine className="h-4 w-4 text-primary" /> Receiver signature</p>
            <SignaturePad onChange={props.onSignature} />
            {props.signatureReady && <p className="mt-2 text-xs text-success">Signature captured.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={props.onClose}><X className="h-4 w-4" /> Close</Button>
            <Button disabled={!ready || props.uploading} onClick={() => void props.onContinue()}>
              {props.uploading ? <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</> : "Continue to Drop OTP"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
