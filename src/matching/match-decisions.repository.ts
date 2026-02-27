import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MatchDecisionType = 'accepted' | 'rejected';

export interface MatchDecisionRecord {
  id: string;
  connectionId: string;
  yourAccountId: string;
  theirAccountId: string;
  yourNormalizedNameSnapshot: string | null;
  theirNormalizedNameSnapshot: string | null;
  decision: MatchDecisionType;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class MatchDecisionsRepository {
  constructor(private prisma: PrismaService) {}

  async findByConnection(connectionId: string): Promise<MatchDecisionRecord[]> {
    const decisions = await this.prisma.accountMatchDecision.findMany({
      where: { connectionId },
      orderBy: { createdAt: 'asc' },
    });

    return decisions.map((decision) => ({
      id: decision.id,
      connectionId: decision.connectionId,
      yourAccountId: decision.yourAccountId,
      theirAccountId: decision.theirAccountId,
      yourNormalizedNameSnapshot: decision.yourNormalizedNameSnapshot,
      theirNormalizedNameSnapshot: decision.theirNormalizedNameSnapshot,
      decision: decision.decision as MatchDecisionType,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    }));
  }

  async upsertDecision(params: {
    connectionId: string;
    yourAccountId: string;
    theirAccountId: string;
    decision: MatchDecisionType;
    yourNormalizedNameSnapshot?: string | null;
    theirNormalizedNameSnapshot?: string | null;
  }): Promise<MatchDecisionRecord> {
    const decision = await this.prisma.accountMatchDecision.upsert({
      where: {
        connectionId_yourAccountId_theirAccountId: {
          connectionId: params.connectionId,
          yourAccountId: params.yourAccountId,
          theirAccountId: params.theirAccountId,
        },
      },
      create: {
        connectionId: params.connectionId,
        yourAccountId: params.yourAccountId,
        theirAccountId: params.theirAccountId,
        yourNormalizedNameSnapshot: params.yourNormalizedNameSnapshot ?? null,
        theirNormalizedNameSnapshot: params.theirNormalizedNameSnapshot ?? null,
        decision: params.decision,
      },
      update: {
        decision: params.decision,
        yourNormalizedNameSnapshot: params.yourNormalizedNameSnapshot ?? null,
        theirNormalizedNameSnapshot: params.theirNormalizedNameSnapshot ?? null,
      },
    });

    return {
      id: decision.id,
      connectionId: decision.connectionId,
      yourAccountId: decision.yourAccountId,
      theirAccountId: decision.theirAccountId,
      yourNormalizedNameSnapshot: decision.yourNormalizedNameSnapshot,
      theirNormalizedNameSnapshot: decision.theirNormalizedNameSnapshot,
      decision: decision.decision as MatchDecisionType,
      createdAt: decision.createdAt,
      updatedAt: decision.updatedAt,
    };
  }
}
