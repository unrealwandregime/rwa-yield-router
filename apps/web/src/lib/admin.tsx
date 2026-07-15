import "server-only";
import { getDatabase, getUserAuthorizationByAuthSubject } from "@rwa-yield-router/database";
import { ShieldAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAuthenticatedSecurityState, getAuthenticatedUser } from "@/lib/supabase/server";

export async function AdminGate({ children }: { children: ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user)
    return (
      <AdminDenied
        title="Sign in required"
        description="Administrator routes require an authenticated, server-authorized account."
        signIn
      />
    );
  if (!process.env.DATABASE_URL)
    return (
      <AdminDenied
        title="Administration is unavailable"
        description="The server database is not configured. Authorization fails closed."
      />
    );
  let authorization: Awaited<ReturnType<typeof getUserAuthorizationByAuthSubject>> = null;
  let authorizationFailed = false;
  try {
    authorization = await getUserAuthorizationByAuthSubject(getDatabase(), {
      provider: "supabase",
      subjectId: user.id
    });
  } catch {
    authorizationFailed = true;
  }
  if (authorizationFailed)
    return (
      <AdminDenied
        title="Authorization could not be verified"
        description="The database authorization check failed safely. No admin data was exposed."
      />
    );
  if (!authorization || !authorization.isAdministrator || authorization.status !== "ACTIVE")
    return (
      <AdminDenied
        title="You are not authorized"
        description="This identity does not have an active administrator grant. Hidden navigation is never treated as authorization."
      />
    );
  if ((await getAuthenticatedSecurityState()).assuranceLevel !== "aal2")
    return (
      <AdminDenied
        title="Multi-factor verification required"
        description="Every administrator session requires AAL2. Enroll or verify a TOTP factor in account settings, then return here."
        securitySettings
      />
    );
  return <>{children}</>;
}

function AdminDenied({
  description,
  securitySettings = false,
  signIn = false,
  title
}: {
  description: string;
  securitySettings?: boolean;
  signIn?: boolean;
  title: string;
}) {
  return (
    <div className="data-state">
      <ShieldAlert aria-hidden size={28} style={{ color: "var(--warning)", margin: "0 auto" }} />
      <span className="eyebrow">Server authorization</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {signIn ? (
        <Link className="button button-primary" href="/auth/sign-in">
          Sign in
        </Link>
      ) : null}
      {securitySettings ? (
        <Link className="button button-primary" href="/settings#mfa">
          Open security settings
        </Link>
      ) : null}
    </div>
  );
}
