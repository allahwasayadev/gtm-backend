import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface ObservedOverlapNotificationClaim {
  userId: string;
  connectionId: string;
  senderNormalizedName: string;
  receiverNormalizedName: string;
}

interface ExistingObservedOverlapNotificationRow {
  userId: string;
  connectionId: string;
  senderNormalizedName: string;
  receiverNormalizedName: string;
}

@Injectable()
export class ObservedOverlapNotificationsRepository {
  constructor(private prisma: PrismaService) {}

  async claimNew(
    claims: ObservedOverlapNotificationClaim[],
  ): Promise<ObservedOverlapNotificationClaim[]> {
    if (!claims.length) {
      return [];
    }

    const uniqueClaims = this.dedupeClaims(claims);
    const existing: ExistingObservedOverlapNotificationRow[] =
      await this.prisma.observedOverlapNotification.findMany({
      where: {
        OR: uniqueClaims.map((claim) => ({
          userId: claim.userId,
          connectionId: claim.connectionId,
          senderNormalizedName: claim.senderNormalizedName,
          receiverNormalizedName: claim.receiverNormalizedName,
        })),
      },
      select: {
        userId: true,
        connectionId: true,
        senderNormalizedName: true,
        receiverNormalizedName: true,
      },
    });

    const existingKeys = new Set(
      existing.map((item: ExistingObservedOverlapNotificationRow) =>
        this.toKey(
          item.userId,
          item.connectionId,
          item.senderNormalizedName,
          item.receiverNormalizedName,
        ),
      ),
    );

    const newlyClaimed: ObservedOverlapNotificationClaim[] = [];

    for (const claim of uniqueClaims) {
      const key = this.toKey(
        claim.userId,
        claim.connectionId,
        claim.senderNormalizedName,
        claim.receiverNormalizedName,
      );

      if (existingKeys.has(key)) {
        continue;
      }

      try {
        await this.prisma.observedOverlapNotification.create({
          data: claim,
        });
        newlyClaimed.push(claim);
        existingKeys.add(key);
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          continue;
        }
        throw error;
      }
    }

    return newlyClaimed;
  }

  private dedupeClaims(
    claims: ObservedOverlapNotificationClaim[],
  ): ObservedOverlapNotificationClaim[] {
    const seen = new Set<string>();
    const deduped: ObservedOverlapNotificationClaim[] = [];

    for (const claim of claims) {
      const key = this.toKey(
        claim.userId,
        claim.connectionId,
        claim.senderNormalizedName,
        claim.receiverNormalizedName,
      );
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      deduped.push(claim);
    }

    return deduped;
  }

  private toKey(
    userId: string,
    connectionId: string,
    senderNormalizedName: string,
    receiverNormalizedName: string,
  ): string {
    return `${userId}::${connectionId}::${senderNormalizedName}::${receiverNormalizedName}`;
  }
}
