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
  connectionId: string;
  partnerName: string;
  partnerCompany: string | null;
  partnerRelationshipType: PartnerRelationshipType;
  resolvedMatches: MatchedAccountResult[];
  suggestedMatches: MatchedAccountResult[];
}

export interface AccountPartnerMatch {
  connectionId: string;
  partnerName: string;
  partnerCompany: string | null;
  partnerRelationshipType: PartnerRelationshipType;
  matchConfidence: number;
  theirAccountName: string;
  theirAccountId: string;
  matchType: MatchType;
}

export type AccountMatchesMap = Record<string, AccountPartnerMatch[]>;

export interface AccountCentricPartnerMatch {
  connectionId: string;
  partnerName: string;
  partnerCompany: string | null;
  partnerRole: PartnerRelationshipType;
  partnerRelationshipType: PartnerRelationshipType;
  confidence: number;
  matchConfidence: number;
  theirAccountName: string;
  theirAccountId: string;
  matchType: MatchType;
}

export interface AccountCentricMatchRow {
  yourAccountId: string;
  yourAccountName: string;
  partners: AccountCentricPartnerMatch[];
}

export interface ConnectionMatchSummary {
  connectionId: string;
  partnerName: string;
  partnerCompany: string | null;
  partnerRole: PartnerRelationshipType;
  partnerRelationshipType: PartnerRelationshipType;
  matchCount: number;
}

export interface AllMatchesResponse {
  matchesMap: AccountMatchesMap;
  accounts: AccountCentricMatchRow[];
  connectionSummaries: ConnectionMatchSummary[];
}

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

  buildAccountMatchesMap(partners: PartnerAccountData[]): AccountMatchesMap {
    const matchesMap: AccountMatchesMap = {};

    for (const {
      connectionId,
      partnerName,
      partnerCompany,
      partnerRelationshipType,
      resolvedMatches,
      suggestedMatches = [],
    } of partners) {
      const allMatches = [...resolvedMatches, ...suggestedMatches];
      for (const match of allMatches) {
        if (!matchesMap[match.yourAccountId]) {
          matchesMap[match.yourAccountId] = [];
        }
        matchesMap[match.yourAccountId].push({
          connectionId,
          partnerName,
          partnerCompany,
          partnerRelationshipType,
          matchConfidence: match.matchConfidence,
          theirAccountName: match.theirAccountName,
          theirAccountId: match.theirAccountId,
          matchType: match.matchType,
        });
      }
    }

    return matchesMap;
  }

  buildAllMatchesResponse(
    yourAccounts: Account[],
    partners: PartnerAccountData[],
  ): AllMatchesResponse {
    const matchesMap = this.buildAccountMatchesMap(partners);
    const accountsById = new Map(
      yourAccounts.map((account) => [account.id, account]),
    );

    const accounts: AccountCentricMatchRow[] = Object.entries(matchesMap)
      .map(([yourAccountId, partnerMatches]) => {
        const yourAccountName =
          accountsById.get(yourAccountId)?.accountName ??
          partnerMatches[0]?.theirAccountName ??
          'Unknown Account';

        const sortedPartners = [...partnerMatches]
          .sort((a, b) => {
            if (b.matchConfidence !== a.matchConfidence) {
              return b.matchConfidence - a.matchConfidence;
            }
            return a.partnerName.localeCompare(b.partnerName);
          })
          .map((partner) => ({
            connectionId: partner.connectionId,
            partnerName: partner.partnerName,
            partnerCompany: partner.partnerCompany,
            partnerRole: partner.partnerRelationshipType,
            partnerRelationshipType: partner.partnerRelationshipType,
            confidence: partner.matchConfidence,
            matchConfidence: partner.matchConfidence,
            theirAccountName: partner.theirAccountName,
            theirAccountId: partner.theirAccountId,
            matchType: partner.matchType,
          }));

        return {
          yourAccountId,
          yourAccountName,
          partners: sortedPartners,
        };
      })
      .sort((a, b) => {
        if (b.partners.length !== a.partners.length) {
          return b.partners.length - a.partners.length;
        }
        return a.yourAccountName.localeCompare(b.yourAccountName);
      });

    const connectionSummaries = partners
      .map((partner) => ({
        connectionId: partner.connectionId,
        partnerName: partner.partnerName,
        partnerCompany: partner.partnerCompany,
        partnerRole: partner.partnerRelationshipType,
        partnerRelationshipType: partner.partnerRelationshipType,
        matchCount:
          partner.resolvedMatches.length +
          (partner.suggestedMatches ?? []).length,
      }))
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) {
          return b.matchCount - a.matchCount;
        }
        return a.partnerName.localeCompare(b.partnerName);
      });

    return {
      matchesMap,
      accounts,
      connectionSummaries,
    };
  }
}
