/**
 * Add Admin role to a user by email.
 * Usage: npx ts-node prisma/add-admin.ts <email>
 *    or: npm run add-admin -- <email>
 * Requires DATABASE_URL in .env (loaded automatically).
 */
import 'dotenv/config';
import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: npm run add-admin -- <email>');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }

  const roles: UserRole[] = [...new Set([...user.roles, UserRole.Admin])];
  await prisma.user.update({
    where: { email },
    data: { roles },
  });

  console.log(`Admin role added to ${email}. Roles: ${roles.join(', ')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
