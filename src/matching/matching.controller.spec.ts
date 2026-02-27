import { AccountListsRepository } from '../account-lists/account-lists.repository';
import type { MatchedAccountResult } from '../common/utils/account-matching.util';
import { ConnectionsRepository } from '../connections/connections.repository';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MatchDecisionsRepository } from './match-decisions.repository';
import { ObservedOverlapNotificationsRepository } from './observed-overlap-notifications.repository';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';

interface TestConnectionState {
  id: string;
  status: string;
  senderId: string;
  receiverId: string;
  createdAt: Date;
  updatedAt: Date;
  senderMutedAt: Date | null;
  senderMutedMatchCount: number | null;
  receiverMutedAt: Date | null;
  receiverMutedMatchCount: number | null;
  lastObservedSharedMatchCount: number | null;
  sender: {
    id: string;
    name: string;
    email: string;
  };
  receiver: {
    id: string;
    name: string;
    email: string;
  };
}

function createResolvedMatch(id: string): MatchedAccountResult {
  return {
    accountName: `Account ${id}`,
    yourAccountName: `Your ${id}`,
    theirAccountName: `Their ${id}`,
    yourAccountId: `your-${id}`,
    theirAccountId: `their-${id}`,
    matchConfidence: 1,
    matchType: 'accepted',
  };
}

function createConnection(
  overrides: Partial<TestConnectionState> = {},
): TestConnectionState {
  return {
    id: 'c-1',
    status: 'accepted',
    senderId: 'sender-1',
    receiverId: 'receiver-1',
    createdAt: new Date('2026-02-19T20:00:00.000Z'),
    updatedAt: new Date('2026-02-19T20:00:00.000Z'),
    senderMutedAt: null,
    senderMutedMatchCount: null,
    receiverMutedAt: null,
    receiverMutedMatchCount: null,
    lastObservedSharedMatchCount: 0,
    sender: {
      id: 'sender-1',
      name: 'Sender One',
      email: 'sender@example.com',
    },
    receiver: {
      id: 'receiver-1',
      name: 'Receiver One',
      email: 'receiver@example.com',
    },
    ...overrides,
  };
}

describe('MatchingController', () => {
  let controller: MatchingController;
  let matchingService: jest.Mocked<MatchingService>;
  let connectionsRepository: jest.Mocked<ConnectionsRepository>;
  let accountListsRepository: jest.Mocked<AccountListsRepository>;
  let emailService: jest.Mocked<EmailService>;
  let notificationsService: jest.Mocked<NotificationsService>;
  let matchDecisionsRepository: jest.Mocked<MatchDecisionsRepository>;
  let observedOverlapNotificationsRepository: jest.Mocked<ObservedOverlapNotificationsRepository>;

  beforeEach(() => {
    matchingService = {
      findMatches: jest.fn(),
      buildAllMatchesResponse: jest.fn(),
    } as unknown as jest.Mocked<MatchingService>;

    connectionsRepository = {
      findAllAcceptedByUser: jest.fn(),
      findAcceptedConnection: jest.fn(),
      findAcceptedConnectionWithUsers: jest.fn(),
      clearMutedForUser: jest.fn(),
      updateLastObservedSharedMatchCount: jest.fn(),
      claimSharedMatchCountUpdate: jest.fn(),
    } as unknown as jest.Mocked<ConnectionsRepository>;

    accountListsRepository = {
      findFirstActive: jest.fn(),
    } as unknown as jest.Mocked<AccountListsRepository>;

    emailService = {
      sendNewOverlapsEmail: jest.fn(),
    } as unknown as jest.Mocked<EmailService>;

    notificationsService = {
      createNewOverlapNotifications: jest.fn(),
    } as unknown as jest.Mocked<NotificationsService>;

    matchDecisionsRepository = {
      findByConnection: jest.fn(),
      upsertDecision: jest.fn(),
    } as unknown as jest.Mocked<MatchDecisionsRepository>;

    observedOverlapNotificationsRepository = {
      claimNew: jest.fn(),
    } as unknown as jest.Mocked<ObservedOverlapNotificationsRepository>;

    controller = new MatchingController(
      matchingService,
      connectionsRepository,
      accountListsRepository,
      emailService,
      notificationsService,
      matchDecisionsRepository,
      observedOverlapNotificationsRepository,
    );
  });

  it('sends new-overlap notifications from accepted match decisions when auto-unmute happens', async () => {
    const connection = createConnection({
      senderMutedAt: new Date('2026-02-19T20:10:00.000Z'),
      senderMutedMatchCount: 1,
      lastObservedSharedMatchCount: 2,
    });

    connectionsRepository.findAcceptedConnectionWithUsers.mockResolvedValue(
      connection as never,
    );
    accountListsRepository.findFirstActive
      .mockResolvedValueOnce({
        accounts: [{ id: 'your-1', accountName: 'Your 1', normalizedName: 'your-1' }],
      } as never)
      .mockResolvedValueOnce({
        accounts: [{ id: 'their-1', accountName: 'Their 1', normalizedName: 'their-1' }],
      } as never);
    matchDecisionsRepository.findByConnection
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'd-1',
          connectionId: 'c-1',
          yourAccountId: 'your-1',
          theirAccountId: 'their-1',
          decision: 'accepted',
          createdAt: new Date('2026-02-19T20:15:00.000Z'),
          updatedAt: new Date('2026-02-19T20:15:00.000Z'),
        },
      ]);
    matchingService.findMatches
      .mockReturnValueOnce({
        resolved: [createResolvedMatch('1')],
        suggested: [],
      })
      .mockReturnValueOnce({
        resolved: [createResolvedMatch('1'), createResolvedMatch('2')],
        suggested: [],
      });
    matchDecisionsRepository.upsertDecision.mockResolvedValue({
      id: 'd-2',
      connectionId: 'c-1',
      yourAccountId: 'your-1',
      theirAccountId: 'their-1',
      decision: 'accepted',
      createdAt: new Date('2026-02-19T20:16:00.000Z'),
      updatedAt: new Date('2026-02-19T20:16:00.000Z'),
    });
    connectionsRepository.clearMutedForUser.mockResolvedValue({
      ...connection,
      senderMutedAt: null,
      senderMutedMatchCount: null,
    } as never);
    notificationsService.createNewOverlapNotifications.mockResolvedValue({
      count: 2,
    });
    observedOverlapNotificationsRepository.claimNew.mockResolvedValue([
      {
        userId: 'sender-1',
        connectionId: 'c-1',
        senderNormalizedName: 'your-1',
        receiverNormalizedName: 'their-1',
      },
      {
        userId: 'receiver-1',
        connectionId: 'c-1',
        senderNormalizedName: 'your-1',
        receiverNormalizedName: 'their-1',
      },
    ]);

    await controller.setMatchDecision(
      'c-1',
      { user: { id: 'sender-1' } },
      {
        yourAccountId: 'your-1',
        theirAccountId: 'their-1',
        decision: 'accepted',
      },
    );
    await new Promise((resolve) => setImmediate(resolve));

    expect(connectionsRepository.clearMutedForUser).toHaveBeenCalledTimes(1);
    expect(notificationsService.createNewOverlapNotifications).toHaveBeenCalledWith([
      {
        userId: 'sender-1',
        connectionName: 'Receiver One',
        connectionId: 'c-1',
        accountName: 'Your 1',
        partnerAccountName: 'Their 1',
      },
      {
        userId: 'receiver-1',
        connectionName: 'Sender One',
        connectionId: 'c-1',
        accountName: 'Their 1',
        partnerAccountName: 'Your 1',
      },
    ]);
  });

  it('returns false when users are not muted', async () => {
    const connection = createConnection({
      senderMutedAt: null,
      receiverMutedAt: null,
    });

    const changed = await (
      controller as unknown as {
        autoUnmuteEligibleUsers: (
          c: TestConnectionState,
          count: number,
        ) => Promise<boolean>;
      }
    ).autoUnmuteEligibleUsers(connection, 3);

    expect(changed).toBe(false);
    expect(connectionsRepository.clearMutedForUser).not.toHaveBeenCalled();
  });

  it('returns false when shared count does not exceed muted threshold', async () => {
    const connection = createConnection({
      senderMutedAt: new Date('2026-02-19T20:05:00.000Z'),
      senderMutedMatchCount: 2,
    });

    const changed = await (
      controller as unknown as {
        autoUnmuteEligibleUsers: (
          c: TestConnectionState,
          count: number,
        ) => Promise<boolean>;
      }
    ).autoUnmuteEligibleUsers(connection, 2);

    expect(changed).toBe(false);
    expect(connectionsRepository.clearMutedForUser).not.toHaveBeenCalled();
  });

  it('returns true when auto-unmuting both users', async () => {
    const original = createConnection({
      senderMutedAt: new Date('2026-02-19T20:05:00.000Z'),
      senderMutedMatchCount: 1,
      receiverMutedAt: new Date('2026-02-19T20:06:00.000Z'),
      receiverMutedMatchCount: 1,
    });

    const senderCleared = {
      ...original,
      senderMutedAt: null,
      senderMutedMatchCount: null,
    };
    const receiverCleared = {
      ...senderCleared,
      receiverMutedAt: null,
      receiverMutedMatchCount: null,
    };

    connectionsRepository.clearMutedForUser
      .mockResolvedValueOnce(senderCleared as never)
      .mockResolvedValueOnce(receiverCleared as never);

    const changed = await (
      controller as unknown as {
        autoUnmuteEligibleUsers: (
          c: TestConnectionState,
          count: number,
        ) => Promise<boolean>;
      }
    ).autoUnmuteEligibleUsers(original, 2);

    expect(connectionsRepository.clearMutedForUser).toHaveBeenCalledTimes(2);
    expect(changed).toBe(true);
  });

  it('still triggers overlap notifications when shared count increases', async () => {
    const connection = createConnection({
      lastObservedSharedMatchCount: 1,
    });
    const sendNewOverlapNotificationsSpy = jest
      .spyOn(
        controller as unknown as {
          sendNewOverlapNotifications: (c: TestConnectionState) => Promise<void>;
        },
        'sendNewOverlapNotifications',
      )
      .mockResolvedValue();

    connectionsRepository.claimSharedMatchCountUpdate.mockResolvedValue(true);

    await (
      controller as unknown as {
        handleSharedMatchCountChange: (
          c: TestConnectionState,
          count: number,
        ) => Promise<boolean>;
      }
    ).handleSharedMatchCountChange(connection, 2);

    expect(connectionsRepository.claimSharedMatchCountUpdate).toHaveBeenCalledWith(
      'c-1',
      1,
      2,
    );
    expect(sendNewOverlapNotificationsSpy).not.toHaveBeenCalled();
  });
});
