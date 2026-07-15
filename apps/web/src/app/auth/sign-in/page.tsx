import { SignInForm } from "@/components/sign-in-form";

export const metadata = { robots: { index: false }, title: "Sign in" };

export default function SignInPage() {
  return (
    <div className="auth-layout">
      <SignInForm />
    </div>
  );
}
