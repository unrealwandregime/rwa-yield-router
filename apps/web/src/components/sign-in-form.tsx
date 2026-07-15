"use client";

import { Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

export function SignInForm() {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    const client = createClient();
    if (!client) {
      setMessage("Email authentication is not configured in this environment.");
      setPending(false);
      return;
    }
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/dashboard` }
    });
    setMessage(
      error
        ? "The sign-in request could not be completed. Try again later."
        : "Check your email for a secure sign-in link."
    );
    setPending(false);
  };

  return (
    <form className="panel auth-card" onSubmit={submit}>
      <span className="eyebrow">Passwordless account</span>
      <h1>Sign in to save your research</h1>
      <p>
        Use a secure email link. RWA Yield Router never asks for a wallet signature, private key, or
        seed phrase.
      </p>
      <label className="field">
        <span>Email address</span>
        <input
          autoComplete="email"
          className="input"
          name="email"
          placeholder="you@example.com"
          required
          type="email"
        />
      </label>
      <button className="button button-primary" disabled={pending} type="submit">
        <Mail aria-hidden size={16} /> {pending ? "Sending…" : "Email me a sign-in link"}
      </button>
      {message ? (
        <p aria-live="polite" className="legal-strip">
          {message}
        </p>
      ) : null}
    </form>
  );
}
