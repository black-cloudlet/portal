/**
 * Authentication wiring: SSO (Keycloak / RHBK) OIDC via Auth.js (NextAuth v5).
 *
 * This reuses the exact SSO setup the Serverless API relies on: the same realm
 * issuer, the standard OIDC Authorization Code + PKCE flow, and the same
 * `groups` claim. Groups are normalized with the ported `normalizeGroup` so the
 * portal and the downstream APIs authorize against identical group names.
 *
 * The access token is kept in the encrypted JWT session cookie (server-side)
 * and forwarded as a Bearer token when the portal calls a downstream API on the
 * user's behalf (see lib/serverless.ts). It is refreshed transparently via the
 * refresh token before it expires.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Keycloak from "next-auth/providers/keycloak";

import { isAdmin, oidc } from "@/lib/config";
import { normalizeGroups } from "@/lib/groups";

/**
 * Decode the claims (payload) of a JWT without verifying its signature. Used to
 * read claims the SSO puts in the *access* token but not the ID token/userinfo.
 * The token was just minted by our own OIDC exchange, so no verification is
 * needed here - we only read it. Returns {} for anything unparseable.
 */
function decodeJwtClaims(jwt: string | undefined): Record<string, unknown> {
  if (!jwt) return {};
  const payload = jwt.split(".")[1];
  if (!payload) return {};
  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pull a groups claim from a claim set as a raw list (string or array). */
function claimGroups(claims: Record<string, unknown>, claim: string): string[] {
  const value = claims[claim];
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string" && value.length > 0) return [value];
  return [];
}

/** Refresh the access token via the Keycloak token endpoint (rotation). */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    const resp = await fetch(`${oidc.issuer.replace(/\/+$/, "")}/protocol/openid-connect/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: oidc.clientId,
        client_secret: oidc.clientSecret,
        refresh_token: token.refreshToken ?? "",
      }),
    });
    const refreshed = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(refreshed));

    return {
      ...token,
      accessToken: refreshed.access_token,
      // Keycloak may or may not rotate the refresh token; keep the old one if not.
      refreshToken: refreshed.refresh_token ?? token.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + Number(refreshed.expires_in ?? 300),
      error: undefined,
    };
  } catch {
    // Surface a re-auth signal to the UI rather than silently 401-ing later.
    return { ...token, error: "RefreshAccessTokenError" };
  }
}

export const authConfig: NextAuthConfig = {
  // Trust the reverse-proxy (OpenShift Route) host/proto headers.
  trustHost: true,
  providers: [
    Keycloak({
      issuer: oidc.issuer,
      clientId: oidc.clientId,
      clientSecret: oidc.clientSecret,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  callbacks: {
    async jwt({ token, account, profile }) {
      // Initial sign-in: capture tokens and the normalized group set.
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        const claims = (profile ?? {}) as Record<string, unknown>;
        // Keycloak (like the Serverless API) commonly carries `groups` in the
        // access token rather than the ID token / userinfo. Read both and merge,
        // so the portal sees the same membership the downstream API authorizes
        // against instead of showing "no group membership".
        const accessClaims = decodeJwtClaims(account.access_token);
        token.groups = normalizeGroups([
          ...claimGroups(claims, oidc.groupsClaim),
          ...claimGroups(accessClaims, oidc.groupsClaim),
        ]);
        token.username =
          (claims.preferred_username as string) ?? (claims.email as string) ?? token.sub ?? "";
        token.name = (claims.name as string) ?? token.name;
        token.email = (claims.email as string) ?? token.email;
        return token;
      }

      // Still valid (with a small clock-skew margin) -> reuse.
      if (token.expiresAt && Date.now() / 1000 < token.expiresAt - 30) {
        return token;
      }

      // Expired -> refresh.
      return token.refreshToken ? refreshAccessToken(token) : token;
    },
    async session({ session, token }) {
      session.user.username = token.username ?? "";
      session.user.groups = token.groups ?? [];
      session.user.isAdmin = isAdmin(token.groups ?? []);
      session.accessToken = token.accessToken;
      session.error = token.error;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
