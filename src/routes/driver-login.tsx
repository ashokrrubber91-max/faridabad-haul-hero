import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthScreen } from "./auth";

const searchSchema = z.object({
  mode: z.enum(["signin", "signup"]).optional(),
  ref: z
    .string()
    .trim()
    .regex(/^MP[A-Z0-9]{8}$/)
    .optional(),
});

export const Route = createFileRoute("/driver-login")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Driver sign in — MiniPort" },
      {
        name: "description",
        content: "Sign in or join as a MiniPort driver to accept mini-truck rides in Faridabad.",
      },
      { property: "og:title", content: "Driver sign in — MiniPort" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: DriverLogin,
});

function DriverLogin() {
  const search = Route.useSearch();
  return <AuthScreen audience="driver" mode={search.mode} referralCode={search.ref} />;
}
