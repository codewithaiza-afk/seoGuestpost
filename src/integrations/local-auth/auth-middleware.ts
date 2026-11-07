import { createMiddleware } from "@tanstack/react-start";

export const requireLocalAuth = createMiddleware({ type: "function" }).server(async ({ next }) => {
  const { getCurrentSessionUser } = await import("@/server/local-auth");
  const user = await getCurrentSessionUser();
  if (!user) throw new Error("Unauthorized: sign in to continue.");

  return next({
    context: {
      userId: user.id,
      userEmail: user.email,
      fullName: user.fullName,
    },
  });
});
