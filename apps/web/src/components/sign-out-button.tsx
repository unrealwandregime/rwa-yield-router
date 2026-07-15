"use client";

import { useState } from "react";
import { browserFetch } from "@/lib/browser-fetch";

export function SignOutButton() {
  const [pending, setPending] = useState(false);

  const signOut = async () => {
    setPending(true);
    try {
      const response = await browserFetch("/auth/sign-out", { method: "POST" });
      if (response.ok || response.redirected) window.location.assign(response.url || "/");
      else setPending(false);
    } catch {
      setPending(false);
    }
  };

  return (
    <button
      className="button button-secondary button-small"
      disabled={pending}
      onClick={() => void signOut()}
      type="button"
    >
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
