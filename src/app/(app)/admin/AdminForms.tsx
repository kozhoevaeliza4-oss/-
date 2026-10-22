"use client";

import { ActionForm, SubmitButton, type ActionState } from "@/components/forms";

type A = (prev: ActionState, fd: FormData) => Promise<ActionState>;
type A0 = (prev: ActionState) => Promise<ActionState>;

export function CreateUserForm({ action }: { action: A }) {
  return (
    <ActionForm action={action} resetOnSuccess>
      <label className="block"><span className="label">E-mail *</span><input name="email" type="email" required className="input" /></label>
      <label className="block"><span className="label">Имя *</span><input name="name" required className="input" /></label>
      <label className="block"><span className="label">Временный пароль * (от 10 символов)</span><input name="password" type="password" required minLength={10} autoComplete="new-password" className="input" /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="isAdmin" /> Системный администратор (доступ ко всем проектам)</label>
      <SubmitButton>Создать пользователя</SubmitButton>
    </ActionForm>
  );
}

export function InlineButton({ action, label, confirm, className = "btn-secondary btn-sm" }: { action: A0; label: string; confirm?: string; className?: string }) {
  return (
    <ActionForm action={action} confirm={confirm} className="inline-flex flex-col">
      <SubmitButton className={className} pendingText="…">{label}</SubmitButton>
    </ActionForm>
  );
}

export function ResetPasswordForm({ action }: { action: A }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex items-start gap-1">
      <input name="password" type="password" minLength={10} required placeholder="Новый пароль" autoComplete="new-password" className="input w-36 py-1 text-xs" />
      <SubmitButton className="btn-secondary btn-sm" pendingText="…">Сменить</SubmitButton>
    </ActionForm>
  );
}

export function RoleForm({
  action,
  role,
  permissions,
}: {
  action: A;
  role: { name: string; description: string | null; permissions: string[] };
  permissions: [string, string][];
}) {
  return (
    <ActionForm action={action}>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="label">Название</span><input name="name" defaultValue={role.name} className="input" /></label>
        <label><span className="label">Описание</span><input name="description" defaultValue={role.description ?? ""} className="input" /></label>
      </div>
      <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
        {permissions.map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="permissions" value={key} defaultChecked={role.permissions.includes(key)} />
            {label} <span className="font-mono text-slate-400">{key}</span>
          </label>
        ))}
      </div>
      <SubmitButton>Сохранить роль</SubmitButton>
    </ActionForm>
  );
}

export function CreateRoleForm({ action }: { action: A }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <label><span className="label">Код (латиница)</span><input name="code" required className="input" /></label>
      <label><span className="label">Название</span><input name="name" required className="input" /></label>
      <SubmitButton>Создать роль</SubmitButton>
    </ActionForm>
  );
}

export function AddMemberForm({ action, roles }: { action: A; roles: { id: string; name: string }[] }) {
  return (
    <ActionForm action={action} resetOnSuccess className="flex flex-wrap items-end gap-2">
      <label className="min-w-[220px] flex-1"><span className="label">E-mail пользователя</span><input name="email" type="email" required className="input" /></label>
      <label>
        <span className="label">Роль</span>
        <select name="roleId" className="input" defaultValue={roles.find((r) => r.name === "Наблюдатель")?.id}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </label>
      <SubmitButton>Добавить</SubmitButton>
    </ActionForm>
  );
}

export function MemberRoleForm({ action, roles, roleId }: { action: A; roles: { id: string; name: string }[]; roleId: string }) {
  return (
    <ActionForm action={action} className="flex items-start gap-1">
      <select name="roleId" defaultValue={roleId} className="input py-1 text-xs">
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
      <SubmitButton className="btn-secondary btn-sm" pendingText="…">Сохранить</SubmitButton>
    </ActionForm>
  );
}
