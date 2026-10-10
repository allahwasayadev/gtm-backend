import { AuthRepository } from './auth.repository';

/**
 * Phone numbers are not unique across rows created before the signup
 * uniqueness check. An unordered findFirst picked an arbitrary account, so a
 * reset for a number held by both a verified and an unverified account could
 * resolve to the unverified one and be silently suppressed.
 *
 * Found in production: +1484…1498 is held by two accounts.
 */
describe('AuthRepository.findUserByPhoneNumber', () => {
  const prisma = { user: { findFirst: jest.fn() } };
  const repo = new AuthRepository(prisma as never);

  beforeEach(() => prisma.user.findFirst.mockReset().mockResolvedValue(null));

  it('asks the database for the verified holder first', async () => {
    await repo.findUserByPhoneNumber('+14843231498');
    const arg = prisma.user.findFirst.mock.calls[0][0];
    expect(arg.where).toEqual({ phoneNumber: '+14843231498' });
    expect(arg.orderBy).toEqual([
      { isPhoneVerified: 'desc' },
      { createdAt: 'asc' },
    ]);
  });

  it('is deterministic rather than dependent on scan order', async () => {
    await repo.findUserByPhoneNumber('+14843231498');
    const { orderBy } = prisma.user.findFirst.mock.calls[0][0];
    // A tiebreak must exist, or two verified rows would still be arbitrary.
    expect(orderBy.length).toBeGreaterThan(1);
  });
});
