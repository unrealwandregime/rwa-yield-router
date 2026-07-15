"use client";

import { KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";

interface VerifiedFactor {
  readonly friendlyName: string;
  readonly id: string;
}

interface Enrollment {
  readonly factorId: string;
  readonly qrCode: string;
  readonly secret: string;
}

const normalizeAssuranceLevel = (value: string | null): "aal1" | "aal2" | null =>
  value === "aal2" ? "aal2" : value === "aal1" ? "aal1" : null;

export function MfaManager() {
  const [assuranceLevel, setAssuranceLevel] = useState<"aal1" | "aal2" | null>(null);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [factors, setFactors] = useState<VerifiedFactor[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const refresh = async () => {
    const client = createClient();
    if (!client) return;
    const [factorResult, assuranceResult] = await Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel()
    ]);
    if (!factorResult.error)
      setFactors(
        factorResult.data.totp
          .filter((factor) => factor.status === "verified")
          .map((factor) => ({
            friendlyName: factor.friendly_name ?? "Authenticator app",
            id: factor.id
          }))
      );
    if (!assuranceResult.error)
      setAssuranceLevel(normalizeAssuranceLevel(assuranceResult.data.currentLevel));
  };

  useEffect(() => {
    const client = createClient();
    if (!client) return;
    void Promise.all([
      client.auth.mfa.listFactors(),
      client.auth.mfa.getAuthenticatorAssuranceLevel()
    ]).then(([factorResult, assuranceResult]) => {
      if (!factorResult.error)
        setFactors(
          factorResult.data.totp
            .filter((factor) => factor.status === "verified")
            .map((factor) => ({
              friendlyName: factor.friendly_name ?? "Authenticator app",
              id: factor.id
            }))
        );
      if (!assuranceResult.error)
        setAssuranceLevel(normalizeAssuranceLevel(assuranceResult.data.currentLevel));
    });
  }, []);

  const beginEnrollment = async () => {
    const client = createClient();
    if (!client) return;
    setPending(true);
    setMessage(null);
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "RWA Yield Router"
    });
    if (error) {
      setMessage("A new authenticator factor could not be created.");
    } else {
      setEnrollment({
        factorId: data.id,
        qrCode: data.totp.qr_code,
        secret: data.totp.secret
      });
      setMessage("Scan the code, then verify the six-digit value before leaving this page.");
    }
    setPending(false);
  };

  const verify = async (event: FormEvent<HTMLFormElement>, factorId: string) => {
    event.preventDefault();
    const client = createClient();
    if (!client) return;
    setPending(true);
    setMessage(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").trim();
    const { error } = await client.auth.mfa.challengeAndVerify({ code, factorId });
    if (error) {
      setMessage("The authenticator code was not accepted. Check the current code and try again.");
    } else {
      setEnrollment(null);
      setMessage("Multi-factor verification succeeded. This session is now AAL2.");
      event.currentTarget.reset();
      await refresh();
    }
    setPending(false);
  };

  const removeFactor = async (factor: VerifiedFactor) => {
    if (!window.confirm(`Remove ${factor.friendlyName}?`)) return;
    const client = createClient();
    if (!client) return;
    setPending(true);
    const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
    setMessage(
      error
        ? "The factor could not be removed. An AAL2 session is required."
        : "Authenticator factor removed."
    );
    if (!error) await refresh();
    setPending(false);
  };

  const activeFactor = factors[0];

  return (
    <section className="panel" id="mfa">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Account security</span>
          <h2>Multi-factor authentication</h2>
          <p>
            Administrator actions require a verified TOTP factor and an AAL2 session. Seed phrases
            and wallet signatures are never used.
          </p>
        </div>
        <span className={`badge ${assuranceLevel === "aal2" ? "badge-good" : "badge-warning"}`}>
          {assuranceLevel === "aal2" ? (
            <ShieldCheck aria-hidden size={14} />
          ) : (
            <ShieldOff aria-hidden size={14} />
          )}
          {assuranceLevel === "aal2" ? "AAL2 verified" : "AAL2 required"}
        </span>
      </div>

      {enrollment ? (
        <div className="mfa-enrollment">
          <Image
            alt="TOTP enrollment QR code"
            className="mfa-qr"
            height={192}
            src={enrollment.qrCode}
            unoptimized
            width={192}
          />
          <div>
            <p>
              Scan this QR code in a trusted authenticator app. If scanning is unavailable, enter
              this one-time setup secret:
            </p>
            <code className="secret-code">{enrollment.secret}</code>
            <form
              className="inline-actions"
              onSubmit={(event) => void verify(event, enrollment.factorId)}
            >
              <label className="field">
                <span>Six-digit authenticator code</span>
                <input
                  autoComplete="one-time-code"
                  className="input"
                  inputMode="numeric"
                  maxLength={6}
                  minLength={6}
                  name="code"
                  pattern="[0-9]{6}"
                  required
                />
              </label>
              <button className="button button-primary" disabled={pending} type="submit">
                <ShieldCheck aria-hidden size={15} /> Verify factor
              </button>
            </form>
          </div>
        </div>
      ) : activeFactor && assuranceLevel !== "aal2" ? (
        <form className="inline-actions" onSubmit={(event) => void verify(event, activeFactor.id)}>
          <label className="field">
            <span>Code from {activeFactor.friendlyName}</span>
            <input
              autoComplete="one-time-code"
              className="input"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="code"
              pattern="[0-9]{6}"
              required
            />
          </label>
          <button className="button button-primary" disabled={pending} type="submit">
            <KeyRound aria-hidden size={15} /> Verify this session
          </button>
        </form>
      ) : null}

      <div className="inline-actions" style={{ marginTop: 18 }}>
        {factors.length === 0 && enrollment === null ? (
          <button
            className="button button-primary"
            disabled={pending}
            onClick={() => void beginEnrollment()}
            type="button"
          >
            <KeyRound aria-hidden size={15} /> Enroll authenticator
          </button>
        ) : null}
        {activeFactor && assuranceLevel === "aal2" ? (
          <button
            className="button button-secondary"
            disabled={pending}
            onClick={() => void removeFactor(activeFactor)}
            type="button"
          >
            Remove {activeFactor.friendlyName}
          </button>
        ) : null}
      </div>
      {message ? (
        <p aria-live="polite" className="legal-strip">
          {message}
        </p>
      ) : null}
    </section>
  );
}
