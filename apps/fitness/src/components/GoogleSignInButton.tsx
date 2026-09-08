"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "sj-last-auth-provider";

function GoogleMark() {
  return (
    <svg
      className="login-google-mark"
      viewBox="0 0 18 18"
      width="18"
      height="18"
      aria-hidden
    >
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.8.54-1.83.86-3.05.86-2.35 0-4.34-1.58-5.05-3.71H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.71A5.41 5.41 0 0 1 3.66 9c0-.59.1-1.17.29-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.82.96 4.04l2.99-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l2.99 2.33C4.66 5.16 6.65 3.58 9 3.58Z"
      />
    </svg>
  );
}

function rememberGoogleSignIn() {
  try {
    localStorage.setItem(STORAGE_KEY, "google");
  } catch {
    /* private mode */
  }
}

/** Google-only CTA with a Plain-style “Last used” chip after a prior sign-in. */
export function GoogleSignInButton({
  children = "Continue with Google",
}: {
  children?: string;
}) {
  const [lastUsed, setLastUsed] = useState(false);

  useEffect(() => {
    try {
      setLastUsed(localStorage.getItem(STORAGE_KEY) === "google");
    } catch {
      setLastUsed(false);
    }
  }, []);

  return (
    <span className="login-google-wrap">
      {lastUsed ? <span className="login-last-used">Last used</span> : null}
      <button
        className="login-button login-google-button"
        type="submit"
        onClick={rememberGoogleSignIn}
      >
        <GoogleMark />
        {children}
      </button>
    </span>
  );
}
