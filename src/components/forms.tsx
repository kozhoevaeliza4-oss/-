"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode } from "react";

export type ActionState = { ok: boolean; message?: string; error?: string; fieldErrors?: Record<string, string> } | null;
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

export function SubmitButton({ children, className = "btn-primary", pendingText = "Сохранение…" }: { children: ReactNode; className?: string; pendingText?: string }) {
  const pending = useContext(PendingContext);
  return (
    <button type="submit" className={className} disabled={pending}>
      {pending ? pendingText : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  if (state.ok) return <p role="status" className="text-sm text-emerald-700">{state.message}</p>;
  return (
    <p role="alert" className="text-sm text-red-700">
      {state.error}
    </p>
  );
}

/**
 * Форма с серверным действием, сообщением об ошибке/успехе и опциональным сбросом.
 * Отправка выполняется вручную, чтобы при ошибке введённые данные не сбрасывались.
 */
export function ActionForm({
  action,
  children,
  className = "space-y-3",
  resetOnSuccess = false,
  confirm,
}: {
  action: Action;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  resetOnSuccess?: boolean;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending) return;
        if (confirm && !window.confirm(confirm)) return;
        // учитываем нажатую кнопку (name/value), если у формы несколько действий
        const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        const fd = new FormData(e.currentTarget, submitter && submitter.name ? submitter : undefined);
        startTransition(() => formAction(fd));
      }}
    >
      <PendingContext.Provider value={pending}>
        {typeof children === "function" ? children(state) : children}
      </PendingContext.Provider>
      <FormMessage state={state} />
    </form>
  );
}
