import { Injectable } from '@nestjs/common';
import { Account } from '@prisma/client';
import { jaroWinkler } from '../common/utils/similarity.util';

const FUZZY_MATCH_THRESHOLD = 0.85;

export interface MatchedAccount {
  accountName: string;
  yourAccountName: string;
  theirAccountName: string;
  yourAccountId: string;
  theirAccountId: string;
  matchConfidence: number;
}

export interface PartnerAccountData {
  partnerName: string;
  partnerCompany: string | null;
  theirAccounts: Account[];
}

@Injectable()
export class MatchingService {
  findMatches(
    yourAccounts: Account[],
    theirAccounts: Account[],
  ): MatchedAccount[] {
    if (!yourAccounts?.length || !theirAccounts?.length) {
      return [];
    }

    const matches: MatchedAccount[] = [];
    const matchedTheirIds = new Set<string>();

    // First pass: exact normalized name match (fast)
    const theirAccountsMap = new Map(
      theirAccounts.map((account) => [account.normalizedName, account]),
    );

    const unmatchedYours: Account[] = [];

    for (const yourAccount of yourAccounts) {
      const theirAccount = theirAccountsMap.get(yourAccount.normalizedName);
      if (theirAccount && !matchedTheirIds.has(theirAccount.id)) {
        matches.push({
          accountName: yourAccount.accountName,
          yourAccountName: yourAccount.accountName,
          theirAccountName: theirAccount.accountName,
          yourAccountId: yourAccount.id,
          theirAccountId: theirAccount.id,
          matchConfidence: 1.0,
        });
        matchedTheirIds.add(theirAccount.id);
      } else {
        unmatchedYours.push(yourAccount);
      }
    }

    // Second pass: fuzzy match remaining unmatched accounts
    const unmatchedTheirs = theirAccounts.filter(
      (a) => !matchedTheirIds.has(a.id),
    );

    for (const yourAccount of unmatchedYours) {
      let bestMatch: Account | null = null;
      let bestScore = 0;

      for (const theirAccount of unmatchedTheirs) {
        const score = jaroWinkler(
          yourAccount.normalizedName,
          theirAccount.normalizedName,
        );
        if (score > bestScore && score >= FUZZY_MATCH_THRESHOLD) {
          bestMatch = theirAccount;
          bestScore = score;
        }
      }

      if (bestMatch) {
        matches.push({
          accountName: yourAccount.accountName,
          yourAccountName: yourAccount.accountName,
          theirAccountName: bestMatch.accountName,
          yourAccountId: yourAccount.id,
          theirAccountId: bestMatch.id,
          matchConfidence: bestScore,
        });
        // Remove from unmatched pool to prevent double-matching
        const idx = unmatchedTheirs.indexOf(bestMatch);
        if (idx !== -1) unmatchedTheirs.splice(idx, 1);
      }
    }

    return matches;
  }

  buildAccountMatchesMap(
    yourAccounts: Account[],
    partners: PartnerAccountData[],
  ): Record<string, Array<{ partnerName: string; partnerCompany: string | null; matchConfidence: number; theirAccountName: string }>> {
    const matchesMap: Record<string, Array<{ partnerName: string; partnerCompany: string | null; matchConfidence: number; theirAccountName: string }>> = {};

    for (const { partnerName, partnerCompany, theirAccounts } of partners) {
      const matched = this.findMatches(yourAccounts, theirAccounts);
      for (const match of matched) {
        if (!matchesMap[match.yourAccountId]) {
          matchesMap[match.yourAccountId] = [];
        }
        matchesMap[match.yourAccountId].push({
          partnerName,
          partnerCompany,
          matchConfidence: match.matchConfidence,
          theirAccountName: match.theirAccountName,
        });
      }
    }

    return matchesMap;
  }
}
