import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/gmail/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const requestUrl = new URL(request.url);
        const appBaseUrl = process.env["APP_BASE_URL"]?.trim();
        if (!appBaseUrl) {
          return new Response("Gmail OAuth is not configured.", { status: 503 });
        }

        const redirect = (returnPath: string, result: string) =>
          Response.redirect(new URL(`${returnPath}?mailbox=${result}`, appBaseUrl), 303);
        if (requestUrl.searchParams.has("error")) return redirect("/campaigns", "denied");

        const state = requestUrl.searchParams.get("state");
        const code = requestUrl.searchParams.get("code");
        if (!state || !code) return redirect("/campaigns", "error");

        try {
          const { finishGmailAuthorization } = await import("@/server/gmail.server");
          const returnPath = await finishGmailAuthorization(state, code);
          return redirect(returnPath, "connected");
        } catch (error) {
          console.error(
            "[gmail-oauth] Authorization callback failed",
            error instanceof Error ? error.message : "Unknown OAuth callback error",
          );
          return redirect("/campaigns", "error");
        }
      },
    },
  },
});
