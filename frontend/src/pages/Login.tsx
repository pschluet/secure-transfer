import { useState } from "react";
import type { FormEvent } from "react";
import { confirmSignIn, signIn } from "aws-amplify/auth";
import { useAuth } from "../context/AuthContext";

export function Login() {
  const { refresh } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleEmailSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { nextStep } = await signIn({
        username: email.trim().toLowerCase(),
        options: { authFlowType: "USER_AUTH", preferredChallenge: "EMAIL_OTP" },
      });
      if (nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE") {
        setStep("code");
      } else if (nextStep.signInStep === "CONTINUE_SIGN_IN_WITH_FIRST_FACTOR_SELECTION") {
        // Shouldn't normally happen since we requested EMAIL_OTP directly, but
        // handle it defensively in case Cognito still offers a choice.
        const confirmed = await confirmSignIn({ challengeResponse: "EMAIL_OTP" });
        if (confirmed.nextStep.signInStep === "CONFIRM_SIGN_IN_WITH_EMAIL_CODE") {
          setStep("code");
        } else {
          setError("This account can't sign in with an email code. Contact the admin.");
        }
      } else {
        setError("This account can't sign in with an email code. Contact the admin.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleCodeSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const { nextStep } = await confirmSignIn({ challengeResponse: code.trim() });
      if (nextStep.signInStep === "DONE") {
        await refresh();
      } else {
        setError("Unexpected sign-in step — please try again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "That code didn't work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <h1>Secure Transfer</h1>
        {step === "email" ? (
          <form onSubmit={handleEmailSubmit}>
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "Sending code…" : "Send code"}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit}>
            <p className="hint">Enter the code we emailed to {email}.</p>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              inputMode="numeric"
              required
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
            />
            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={busy}>
              {busy ? "Verifying…" : "Verify"}
            </button>
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep("email");
                setCode("");
                setError(null);
              }}
            >
              Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
