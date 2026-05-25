export default function Home() {
  return (
    <main
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100dvh",
        gap: "16px",
      }}
    >
      <h1 style={{ fontSize: "2.5rem", fontWeight: 700 }}>
        Code<span style={{ color: "var(--color-accent)" }}>Collab</span>
      </h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "1.1rem" }}>
        Real-time collaborative code review — coming to life.
      </p>
      <p
        style={{
          color: "var(--color-text-tertiary)",
          fontSize: "0.85rem",
          fontFamily: "var(--font-mono)",
        }}
      >
        Layer 1 — Scaffolding complete ✓
      </p>
    </main>
  );
}
