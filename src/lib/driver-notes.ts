export const NOTE_PHOTO_LIMIT = 5 * 1024 * 1024;
export const NOTE_AUDIO_LIMIT = 5 * 1024 * 1024;
export const NOTE_ATTACHMENT_LIMIT = 4;
export const NOTE_RECORDING_SECONDS = 60;
export type NoteAttachment = { id: string; kind: "photo" | "audio"; file: File; url: string };

/** Strip credential artifacts, not legitimate delivery links or ordinary prose. */
export function sanitizeDriverNotes(value: string): string {
  return value
    .replace(/https?:\/\/[^\s]+/gi, (url) =>
      /[?#&](?:access_token|refresh_token|code_verifier|id_token)=/i.test(url) ? "" : url,
    )
    .replace(/\b(?:access_token|refresh_token|code_verifier|id_token)\s*[=:]\s*[^\s&]+/gi, "")
    .replace(/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .trimStart();
}

export function validateNoteFile(
  file: Pick<File, "type" | "size">,
  kind: "photo" | "audio",
): string | null {
  const allowed =
    kind === "photo"
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg"];
  if (!allowed.includes(file.type.split(";")[0]))
    return kind === "photo"
      ? "Choose a JPEG, PNG or WebP photo."
      : "This audio format is not supported.";
  if (file.size <= 0) return "That attachment is empty.";
  if (file.size > (kind === "photo" ? NOTE_PHOTO_LIMIT : NOTE_AUDIO_LIMIT))
    return "Each attachment must be 5 MB or smaller.";
  return null;
}
