import { createServerFn } from "@tanstack/react-start";

import { requireLocalAuth } from "@/integrations/local-auth/auth-middleware";

export const getCurrentUser = createServerFn({ method: "GET" }).handler(async () => {
  const { getCurrentUser: getUser } = await import("@/server/auth.server");
  return getUser();
});

export const signUp = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string; fullName: string }) => input)
  .handler(async ({ data }) => {
    const { signUp: createAccount } = await import("@/server/auth.server");
    return createAccount(data);
  });

export const signIn = createServerFn({ method: "POST" })
  .validator((input: { email: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { signIn: authenticate } = await import("@/server/auth.server");
    return authenticate(data);
  });

export const signOut = createServerFn({ method: "POST" })
  .middleware([requireLocalAuth])
  .handler(async () => {
    const { signOut: endSession } = await import("@/server/auth.server");
    return endSession();
  });

export const requestPasswordReset = createServerFn({ method: "POST" })
  .validator((input: { email: string }) => input)
  .handler(async ({ data }) => {
    const { requestPasswordReset: sendReset } = await import("@/server/auth.server");
    return sendReset(data);
  });

export const resetPassword = createServerFn({ method: "POST" })
  .validator((input: { token: string; password: string }) => input)
  .handler(async ({ data }) => {
    const { resetPassword: updatePassword } = await import("@/server/auth.server");
    return updatePassword(data);
  });
