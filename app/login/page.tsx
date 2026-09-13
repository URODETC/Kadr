"use client";
import { useState } from "react";
export default function Login() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="login-screen">
      <form
        className="login-card"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          const data = new FormData(e.currentTarget);
          try {
            const r = await fetch("/api/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(Object.fromEntries(data)),
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error);
            location.replace("/");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Ошибка подключения");
            setBusy(false);
          }
        }}
      >
        <div className="brand">
          кадр<span> / anime</span>
        </div>
        <p>Войдите, чтобы продолжить.</p>
        <label>
          Логин
          <input
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            autoCapitalize="none"
            spellCheck={false}
          />
        </label>
        <label>
          Пароль
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy}>
          {busy ? "Входим…" : "Войти"}
        </button>
      </form>
    </main>
  );
}
