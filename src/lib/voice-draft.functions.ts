import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const getVoiceBookingDraft = createServerFn({ method: "GET" })
  .inputValidator((value) => z.object({ token: z.string().min(20).max(100) }).parse(value))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: draft, error } = await supabaseAdmin
      .from("voice_booking_drafts")
      .select("id,parsed_data,transcript,status,expires_at,created_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!draft) throw new Error("Draft not found");
    if (new Date(draft.expires_at).getTime() < Date.now()) throw new Error("This draft link has expired");
    return draft;
  });
