"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import styles from "../../../components/editor.module.css";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Editor Error Boundary caught:", error);
  }, [error]);

  return (
    <div className={styles.errorBox}>
      <div className={styles.emptyIcon}>🚨</div>
      <h2>Something went wrong!</h2>
      <p style={{ color: "var(--color-text-secondary)", marginBottom: "var(--spacing-lg)" }}>
        {error.message || "An unexpected error occurred in the editor."}
      </p>
      
      <div style={{ display: "flex", gap: "var(--spacing-md)" }}>
        <button
          className={styles.button}
          onClick={() => reset()}
        >
          Try again
        </button>
        <Link href="/">
          <button className={styles.button} style={{ background: "rgba(255, 255, 255, 0.1)" }}>
            Return to Dashboard
          </button>
        </Link>
      </div>
    </div>
  );
}
