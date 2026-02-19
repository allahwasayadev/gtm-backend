import { Injectable } from '@nestjs/common';
import { Account } from '@prisma/client';
import {
  type CategorizedMatches,
  findMatchedAccounts,
  type MatchDecisionPair,
  type MatchedAccountResult,
  type MatchType,
} from '../common/utils/account-matching.util';
export type PartnerRelationshipType = 'OEM' | 'RESELLER';

export interface PartnerAccountData {
  partnerName: string;
  partnerCompany: string | null;
  partnerRelationshipType: PartnerRelationshipType;
  resolvedMatches: MatchedAccountResult[];
}

export interface AccountPartnerMatch {
  partnerName: string;
  partnerCompany: string | null;
  partnerRelationshipType: PartnerRelationshipType;
  matchConfidence: number;
  theirAccountName: string;
  matchType: MatchType;
}

export type AccountMatchesMap = Record<string, AccountPartnerMatch[]>;

export interface FindMatchesOptions {
  acceptedPairs?: MatchDecisionPair[];
  rejectedPairs?: MatchDecisionPair[];
}

@Injectable()
export class MatchingService {
  findMatches(
    yourAccounts: Account[],
    theirAccounts: Account[],
    options?: FindMatchesOptions,
  ): CategorizedMatches {
    return findMatchedAccounts(yourAccounts, theirAccounts, options);
  }

  buildResolvedAccountMatchesMap(
    partners: PartnerAccountData[],
  ): AccountMatchesMap {
    const matchesMap: AccountMatchesMap = {};

    for (const {
      partnerName,
      partnerCompany,
      partnerRelationshipType,
      resolvedMatches,
    } of partners) {
      for (const match of resolvedMatches) {
        if (!matchesMap[match.yourAccountId]) {
          matchesMap[match.yourAccountId] = [];
        }
        matchesMap[match.yourAccountId].push({
          partnerName,
          partnerCompany,
          partnerRelationshipType,
          matchConfidence: match.matchConfidence,
          theirAccountName: match.theirAccountName,
          matchType: match.matchType,
        });
      }
    }

    return matchesMap;
  }
}
