"use client";

import { ActionForm, SubmitButton } from "@/components/forms";
import { loginAction } from "./actions";

export function LoginForm() {
  return (
    <ActionForm action={loginAction}>
      <label className="block">
        <span className="label">E-mail</span>
        <input name="email" type="email" autoComplete="username" required className="input" />
      </label>
      <label className="block">
        <span className="label">Пароль</span>
        <input name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      <SubmitButton className="btn-primary w-full" pendingText="Вход…">
        Войти
      </SubmitButton>
    </ActionForm>
  );
}
