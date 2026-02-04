import { Injectable } from '@nestjs/common';
import { Account } from '@prisma/client';

export interface MatchedAccount {
  accountName: string;
  yourAccountId: string;
  theirAccountId: string;
  type: string | null;
  theirType: string | null;
}

@Injectable()
export class MatchingService {
  findMatches(
    yourAccounts: Account[],
    theirAccounts: Account[],
  ): MatchedAccount[] {
    if (!yourAccounts || yourAccounts.length === 0) {
      return [];
    }

    if (!theirAccounts || theirAccounts.length === 0) {
      return [];
    }

    const matches: MatchedAccount[] = [];
    const theirAccountsMap = new Map(
      theirAccounts.map((account) => [account.normalizedName, account]),
    );

    for (const yourAccount of yourAccounts) {
      const theirAccount = theirAccountsMap.get(yourAccount.normalizedName);
      if (theirAccount) {
        matches.push({
          accountName: yourAccount.accountName,
          yourAccountId: yourAccount.id,
          theirAccountId: theirAccount.id,
          type: yourAccount.type,
          theirType: theirAccount.type,
        });
      }
    }

    return matches;
  }
}
