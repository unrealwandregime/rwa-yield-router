import { LockKeyhole } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export async function AccountGate({ children }: { children: ReactNode }) {
  const user = await getAuthenticatedUser();
  if (!user) {
    return (
      <div className="data-state">
        <LockKeyhole aria-hidden size={26} style={{ margin: "0 auto", color: "var(--accent)" }} />
        <span className="eyebrow">Account required</span>
        <h2>Sign in to use this private workspace</h2>
        <p>
          Public market research remains available without an account. Saved objects and alerts are
          server-authorized to the signed-in user.
        </p>
        <Link className="button button-primary" href="/auth/sign-in">
          Sign in securely
        </Link>
      </div>
    );
  }
  return <>{children}</>;
}
