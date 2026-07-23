import { redirect } from "next/navigation";

import Icon from "@/components/Icon";
import { auth, signIn, REAUTH_ERROR } from "@/auth";
import { branding } from "@/lib/config";

/**
 * Sign-in landing. If already authenticated it bounces to the console; otherwise
 * it presents a single "Sign in with SSO" action that starts the Keycloak
 * Authorization Code + PKCE flow. No local accounts - identity is SSO only.
 *
 * A session flagged for re-auth (its token could no longer be refreshed) still
 * exists but is unusable downstream, so we do NOT bounce it back to the console
 * - that would loop with the middleware. Instead we show the sign-in action and
 * a note so the user can mint a fresh token.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const session = await auth();
  const { callbackUrl } = await searchParams;
  const needsReauth = session?.error === REAUTH_ERROR;
  if (session && !needsReauth) redirect(callbackUrl || "/dashboard");

  return (
    <main className="login">
      <div className="login__card">
        <div className="login__logo" aria-hidden="true">
          <Icon name="cloud" size={44} />
        </div>
        <h1 className="login__title">{branding.productName}</h1>
        <p className="login__subtitle">{branding.organization} platform console</p>
        {needsReauth && (
          <p className="notice notice--warn login__notice" role="alert">
            Your session has expired. Please sign in again to continue.
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("keycloak", { redirectTo: callbackUrl || "/dashboard" });
          }}
        >
          <button className="btn btn--primary login__button" type="submit">
            Sign in with SSO
          </button>
        </form>
        <p className="login__hint">You will be redirected to your organization&rsquo;s sign-in.</p>
      </div>
    </main>
  );
}
