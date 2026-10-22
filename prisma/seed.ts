/**
 * Начальные данные: системные роли и первый администратор.
 * Пароль администратора берётся из переменных окружения, в репозитории не хранится.
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { DEFAULT_ROLES, PERMISSIONS_ADDED_V2 } from "../src/lib/permissions";

const prisma = new PrismaClient();

async function main() {
  for (const r of DEFAULT_ROLES) {
    // Новые права версии 2 добавляются существующим системным ролям (прочие изменения администратора сохраняются)
    const existing = await prisma.role.findUnique({ where: { code: r.code } });
    if (existing) {
      const add = PERMISSIONS_ADDED_V2.filter((p) => r.permissions.includes(p) && !existing.permissions.includes(p));
      if (add.length) await prisma.role.update({ where: { id: existing.id }, data: { permissions: [...existing.permissions, ...add] } });
    }
    await prisma.role.upsert({
      where: { code: r.code },
      // Состав прав существующих ролей не перезаписывается — его мог изменить администратор.
      update: { isSystem: true },
      create: { code: r.code, name: r.name, description: r.description, permissions: r.permissions, isSystem: true },
    });
  }
  console.log(`Роли: ${DEFAULT_ROLES.length}`);

  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD не заданы — администратор не создан");
    return;
  }
  if (password.length < 10) throw new Error("SEED_ADMIN_PASSWORD должен быть не короче 10 символов");
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Администратор ${email} уже существует — пароль не изменён`);
    return;
  }
  await prisma.user.create({
    data: { email, name: "Администратор", passwordHash: await bcrypt.hash(password, 12), isAdmin: true },
  });
  console.log(`Создан администратор ${email}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
