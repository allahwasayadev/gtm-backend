import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Server } from 'http';
import request from 'supertest';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Authorization, exercised at runtime through the real guard stack.
 *
 * Metadata assertions prove a decorator is present; they cannot prove what
 * Nest does with it — and the thing that nearly went wrong here was exactly
 * that, a method-level @UseGuards that Nest ADDS to the controller's guard
 * instead of replacing it, leaving the gate running and the route unreachable.
 *
 * So these go over HTTP, through passport and JwtAuthGuard, with a real
 * signed token. What is asserted:
 *
 *   anonymous                      -> 401 on both phone-verification routes
 *   authenticated, unverified      -> reaches its OWN handler on both
 *   authenticated, unverified      -> 403 on an unrelated protected route
 *   authenticated, verified        -> everything open, as before
 */
describe('UsersController — authorization at runtime', () => {
  let app: INestApplication;
  let jwt: JwtService;

  const SECRET = 'test-secret-for-authz-spec';

  const UNVERIFIED = {
    id: 'u-unverified',
    email: 'unverified@example.test',
    name: 'Unverified',
    company: null,
    roles: ['OEM'],
    emailVerified: true,
    createdAt: new Date(),
    isPhoneVerified: false,
    phoneNumber: '+12015550123',
  };

  const VERIFIED = { ...UNVERIFIED, id: 'u-verified', isPhoneVerified: true };

  /** Sentinels: reaching a handler is proved by its own response body. */
  const usersService = {
    getProfile: jest.fn().mockResolvedValue({ reached: 'getProfile' }),
    updateProfile: jest.fn().mockResolvedValue({ reached: 'updateProfile' }),
    sendPhoneVerificationCode: jest
      .fn()
      .mockResolvedValue({ reached: 'sendPhoneVerificationCode' }),
    verifyPhoneVerificationCode: jest
      .fn()
      .mockResolvedValue({ reached: 'verifyPhoneVerificationCode' }),
    withdrawSmsConsent: jest.fn().mockResolvedValue({ reached: 'withdraw' }),
    completeOnboarding: jest.fn().mockResolvedValue({ reached: 'onboarding' }),
    listAllForAdmin: jest.fn().mockResolvedValue([]),
    getAdminStats: jest.fn().mockResolvedValue({}),
    deleteAccount: jest.fn().mockResolvedValue({ reached: 'delete' }),
  };

  const prisma = {
    user: {
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(
          where.id === VERIFIED.id
            ? VERIFIED
            : where.id === UNVERIFIED.id
              ? UNVERIFIED
              : null,
        ),
      ),
    },
  };

  const tokenFor = (userId: string, email: string) =>
    jwt.sign({ sub: userId, email });

  /** getHttpServer() is untyped; name it once rather than at every call. */
  const server = (): Server => app.getHttpServer() as Server;

  beforeAll(async () => {
    process.env.JWT_SECRET = SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        PassportModule,
        JwtModule.register({
          secret: SECRET,
          signOptions: { expiresIn: '1h' },
        }),
      ],
      controllers: [UsersController],
      providers: [
        JwtStrategy,
        { provide: UsersService, useValue: usersService },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    jwt = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('anonymous', () => {
    it.each([
      ['/users/profile/phone-verification/send'],
      ['/users/profile/phone-verification/verify'],
    ])('is refused with 401 at %s', async (path) => {
      await request(server()).post(path).send({}).expect(401);
    });

    it('is refused with 401 at an ordinary route', async () => {
      await request(server()).get('/users/profile').expect(401);
    });

    it('reached no handler at all', () => {
      expect(usersService.sendPhoneVerificationCode).not.toHaveBeenCalled();
      expect(usersService.verifyPhoneVerificationCode).not.toHaveBeenCalled();
      expect(usersService.getProfile).not.toHaveBeenCalled();
    });
  });

  describe('authenticated but not phone-verified', () => {
    const auth = () => `Bearer ${tokenFor(UNVERIFIED.id, UNVERIFIED.email)}`;

    it('reaches its own send handler', async () => {
      const res = await request(server())
        .post('/users/profile/phone-verification/send')
        .set('Authorization', auth())
        .send({ phoneNumber: '2015550123' })
        .expect(201);

      expect(res.body).toEqual({ reached: 'sendPhoneVerificationCode' });
      expect(usersService.sendPhoneVerificationCode).toHaveBeenCalledWith(
        UNVERIFIED.id,
        expect.objectContaining({ phoneNumber: '2015550123' }),
        expect.anything(),
      );
    });

    // The step that used to be unreachable: sending a code un-verifies the
    // session, and the gate then refused the request submitting that code.
    it('reaches its own verify handler', async () => {
      const res = await request(server())
        .post('/users/profile/phone-verification/verify')
        .set('Authorization', auth())
        .send({ code: '123456' })
        .expect(201);

      expect(res.body).toEqual({ reached: 'verifyPhoneVerificationCode' });
      expect(usersService.verifyPhoneVerificationCode).toHaveBeenCalledWith(
        UNVERIFIED.id,
        expect.objectContaining({ code: '123456' }),
      );
    });

    it('acts only on its own account — the id comes from the token', async () => {
      await request(server())
        .post('/users/profile/phone-verification/verify')
        .set('Authorization', auth())
        .send({ code: '123456', userId: VERIFIED.id })
        .expect(201);

      expect(usersService.verifyPhoneVerificationCode).toHaveBeenCalledWith(
        UNVERIFIED.id,
        expect.anything(),
      );
    });

    // The exemption is two routes wide, not a hole in the gate.
    it.each([
      ['get', '/users/profile'],
      ['post', '/users/profile/sms-consent/withdraw'],
    ])('is still refused with 403 at %s %s', async (method, path) => {
      const res = await request(server())
        [method as 'get' | 'post'](path)
        .set('Authorization', auth())
        .send({})
        .expect(403);

      expect(res.body).toMatchObject({ code: 'PHONE_VERIFICATION_REQUIRED' });
      expect(usersService.getProfile).not.toHaveBeenCalled();
      expect(usersService.withdrawSmsConsent).not.toHaveBeenCalled();
    });
  });

  describe('authenticated and phone-verified', () => {
    const auth = () => `Bearer ${tokenFor(VERIFIED.id, VERIFIED.email)}`;

    it('reaches ordinary routes as before', async () => {
      const res = await request(server())
        .get('/users/profile')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toEqual({ reached: 'getProfile' });
    });
  });

  describe('a token that is not a session', () => {
    it('refuses an activation token with 401', async () => {
      const activation = jwt.sign({
        sub: UNVERIFIED.id,
        email: UNVERIFIED.email,
        scope: 'activation',
      });

      await request(server())
        .post('/users/profile/phone-verification/verify')
        .set('Authorization', `Bearer ${activation}`)
        .send({ code: '123456' })
        .expect(401);

      expect(usersService.verifyPhoneVerificationCode).not.toHaveBeenCalled();
    });
  });
});
