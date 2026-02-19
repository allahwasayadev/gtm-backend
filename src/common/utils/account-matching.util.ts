import { Account } from '@prisma/client';
import { jaroWinkler } from './similarity.util';

export const EXACT_MATCH_CONFIDENCE = 1.0;
export const AUTO_RESOLVE_THRESHOLD = 0.95;
export const SUGGEST_THRESHOLD = 0.5;
export type MatchType = 'exact' | 'auto' | 'suggested' | 'accepted';

export interface MatchedAccountResult {
  accountName: string;
  yourAccountName: string;
  theirAccountName: string;
  yourAccountId: string;
  theirAccountId: string;
  matchConfidence: number;
  matchType: MatchType;
}

export interface MatchDecisionPair {
  yourAccountId: string;
  theirAccountId: string;
}

export interface FindMatchedAccountsOptions {
  acceptedPairs?: MatchDecisionPair[];
  rejectedPairs?: MatchDecisionPair[];
}

export interface CategorizedMatches {
  resolved: MatchedAccountResult[];
  suggested: MatchedAccountResult[];
}

interface TokenScores {
  overlapCount: number;
  tokenJaccard: number;
  tokenContainment: number;
}

interface CandidateMatchEvaluation {
  confidence: number;
  matchType: 'auto' | 'suggested' | null;
}

export function findMatchedAccounts(
  yourAccounts: Account[],
  theirAccounts: Account[],
  options?: FindMatchedAccountsOptions,
): CategorizedMatches {
  if (!yourAccounts?.length || !theirAccounts?.length) {
    return { resolved: [], suggested: [] };
  }

  const resolved: MatchedAccountResult[] = [];
  const suggested: MatchedAccountResult[] = [];
  const matchedYourIds = new Set<string>();
  const matchedTheirIds = new Set<string>();
  const rejectedPairKeys = new Set(
    (options?.rejectedPairs ?? []).map((pair) =>
      buildPairKey(pair.yourAccountId, pair.theirAccountId),
    ),
  );

  const yourAccountById = new Map(
    yourAccounts.map((account) => [account.id, account]),
  );
  const theirAccountById = new Map(
    theirAccounts.map((account) => [account.id, account]),
  );
  const theirByNormalizedName = new Map<string, Account[]>();

  for (const theirAccount of theirAccounts) {
    const existing =
      theirByNormalizedName.get(theirAccount.normalizedName) ?? [];
    existing.push(theirAccount);
    theirByNormalizedName.set(theirAccount.normalizedName, existing);
  }

  for (const acceptedPair of options?.acceptedPairs ?? []) {
    const yourAccount = yourAccountById.get(acceptedPair.yourAccountId);
    const theirAccount = theirAccountById.get(acceptedPair.theirAccountId);
    if (!yourAccount || !theirAccount) {
      continue;
    }

    if (
      matchedYourIds.has(yourAccount.id) ||
      matchedTheirIds.has(theirAccount.id)
    ) {
      continue;
    }

    const acceptedConfidence = calculateCompositeConfidence(
      yourAccount.normalizedName,
      theirAccount.normalizedName,
    );

    resolved.push(
      toMatchedAccountResult(
        yourAccount,
        theirAccount,
        acceptedConfidence,
        'accepted',
      ),
    );
    matchedYourIds.add(yourAccount.id);
    matchedTheirIds.add(theirAccount.id);
  }

  for (const yourAccount of yourAccounts) {
    if (matchedYourIds.has(yourAccount.id)) {
      continue;
    }

    const candidates =
      theirByNormalizedName.get(yourAccount.normalizedName) ?? [];
    const exactCandidate = candidates.find((theirAccount) => {
      if (matchedTheirIds.has(theirAccount.id)) {
        return false;
      }

      return !isRejectedPair(rejectedPairKeys, yourAccount.id, theirAccount.id);
    });

    if (!exactCandidate) {
      continue;
    }

    resolved.push(
      toMatchedAccountResult(
        yourAccount,
        exactCandidate,
        EXACT_MATCH_CONFIDENCE,
        'exact',
      ),
    );
    matchedYourIds.add(yourAccount.id);
    matchedTheirIds.add(exactCandidate.id);
  }

  const unmatchedYours = yourAccounts.filter(
    (account) => !matchedYourIds.has(account.id),
  );
  const unmatchedTheirs = theirAccounts.filter(
    (account) => !matchedTheirIds.has(account.id),
  );

  for (const yourAccount of unmatchedYours) {
    let bestAutoMatch: { theirAccount: Account; confidence: number } | null =
      null;

    for (const theirAccount of unmatchedTheirs) {
      if (matchedTheirIds.has(theirAccount.id)) {
        continue;
      }
      if (isRejectedPair(rejectedPairKeys, yourAccount.id, theirAccount.id)) {
        continue;
      }

      const evaluation = evaluateCandidateMatch(yourAccount, theirAccount);
      if (evaluation.matchType !== 'auto') {
        continue;
      }

      if (!bestAutoMatch || evaluation.confidence > bestAutoMatch.confidence) {
        bestAutoMatch = { theirAccount, confidence: evaluation.confidence };
      }
    }

    if (!bestAutoMatch) {
      continue;
    }

    resolved.push(
      toMatchedAccountResult(
        yourAccount,
        bestAutoMatch.theirAccount,
        bestAutoMatch.confidence,
        'auto',
      ),
    );
    matchedYourIds.add(yourAccount.id);
    matchedTheirIds.add(bestAutoMatch.theirAccount.id);
  }

  const stillUnmatchedYours = yourAccounts.filter(
    (account) => !matchedYourIds.has(account.id),
  );

  for (const yourAccount of stillUnmatchedYours) {
    let bestSuggestedMatch: {
      theirAccount: Account;
      confidence: number;
    } | null = null;

    for (const theirAccount of unmatchedTheirs) {
      if (matchedTheirIds.has(theirAccount.id)) {
        continue;
      }
      if (isRejectedPair(rejectedPairKeys, yourAccount.id, theirAccount.id)) {
        continue;
      }

      const evaluation = evaluateCandidateMatch(yourAccount, theirAccount);
      if (evaluation.matchType !== 'suggested') {
        continue;
      }

      if (
        !bestSuggestedMatch ||
        evaluation.confidence > bestSuggestedMatch.confidence
      ) {
        bestSuggestedMatch = {
          theirAccount,
          confidence: evaluation.confidence,
        };
      }
    }

    if (!bestSuggestedMatch) {
      continue;
    }

    suggested.push(
      toMatchedAccountResult(
        yourAccount,
        bestSuggestedMatch.theirAccount,
        bestSuggestedMatch.confidence,
        'suggested',
      ),
    );
    matchedYourIds.add(yourAccount.id);
    matchedTheirIds.add(bestSuggestedMatch.theirAccount.id);
  }

  return { resolved, suggested };
}

function toMatchedAccountResult(
  yourAccount: Account,
  theirAccount: Account,
  confidence: number,
  matchType: MatchType,
): MatchedAccountResult {
  return {
    accountName: yourAccount.accountName,
    yourAccountName: yourAccount.accountName,
    theirAccountName: theirAccount.accountName,
    yourAccountId: yourAccount.id,
    theirAccountId: theirAccount.id,
    matchConfidence: clampConfidence(confidence),
    matchType,
  };
}

function evaluateCandidateMatch(
  yourAccount: Account,
  theirAccount: Account,
): CandidateMatchEvaluation {
  const yourNormalized = yourAccount.normalizedName;
  const theirNormalized = theirAccount.normalizedName;

  if (hasDifferentNumericTokens(yourNormalized, theirNormalized)) {
    return { confidence: 0, matchType: null };
  }

  const jw = jaroWinkler(yourNormalized, theirNormalized);
  const tokenScores = calculateTokenScores(yourNormalized, theirNormalized);
  if (!passesTokenGuard(tokenScores, jw)) {
    return { confidence: 0, matchType: null };
  }
  if (!passesShortNameGuard(yourNormalized, theirNormalized, jw)) {
    return { confidence: 0, matchType: null };
  }

  const confidence = calculateCompositeConfidence(
    yourNormalized,
    theirNormalized,
    tokenScores,
    jw,
  );

  if (
    confidence >= AUTO_RESOLVE_THRESHOLD &&
    passesAutoResolveGuard(tokenScores, jw)
  ) {
    return { confidence, matchType: 'auto' };
  }

  if (confidence >= SUGGEST_THRESHOLD) {
    return { confidence, matchType: 'suggested' };
  }

  return { confidence, matchType: null };
}

function calculateCompositeConfidence(
  yourNormalized: string,
  theirNormalized: string,
  providedScores?: TokenScores,
  providedJw?: number,
): number {
  const tokenScores =
    providedScores ?? calculateTokenScores(yourNormalized, theirNormalized);
  const jw = providedJw ?? jaroWinkler(yourNormalized, theirNormalized);
  const baseScore =
    jw * 0.85 +
    tokenScores.tokenContainment * 0.1 +
    tokenScores.tokenJaccard * 0.05;

  const yourLength = yourNormalized.replace(/\s+/g, '').length;
  const theirLength = theirNormalized.replace(/\s+/g, '').length;
  const minLength = Math.min(yourLength, theirLength);
  const maxLength = Math.max(yourLength, theirLength);

  let lengthPenalty = 0;
  if (maxLength > 0) {
    const lengthRatio = minLength / maxLength;
    if (lengthRatio < 0.5) {
      lengthPenalty = 0.15;
    } else if (lengthRatio < 0.7) {
      lengthPenalty = 0.08;
    }
  }

  return clampConfidence(baseScore - lengthPenalty);
}

function calculateTokenScores(
  yourNormalized: string,
  theirNormalized: string,
): TokenScores {
  const yourTokens = new Set(tokenize(yourNormalized));
  const theirTokens = new Set(tokenize(theirNormalized));

  let overlapCount = 0;
  for (const token of yourTokens) {
    if (theirTokens.has(token)) {
      overlapCount += 1;
    }
  }

  const unionCount = new Set([...yourTokens, ...theirTokens]).size;
  const smallerTokenCount = Math.min(yourTokens.size, theirTokens.size);

  return {
    overlapCount,
    tokenJaccard: unionCount > 0 ? overlapCount / unionCount : 0,
    tokenContainment:
      smallerTokenCount > 0 ? overlapCount / smallerTokenCount : 0,
  };
}

function passesTokenGuard(tokenScores: TokenScores, jw: number): boolean {
  if (tokenScores.overlapCount === 0) {
    return false;
  }
  if (tokenScores.tokenContainment < 0.34) {
    return false;
  }
  if (tokenScores.tokenContainment < 0.5 && tokenScores.tokenJaccard < 0.34) {
    return false;
  }
  if (jw < 0.74 && tokenScores.tokenContainment < 0.6) {
    return false;
  }

  return true;
}

function passesAutoResolveGuard(tokenScores: TokenScores, jw: number): boolean {
  return (
    jw >= 0.9 &&
    tokenScores.tokenContainment >= 0.75 &&
    tokenScores.tokenJaccard >= 0.45
  );
}

function passesShortNameGuard(
  yourNormalized: string,
  theirNormalized: string,
  jw: number,
): boolean {
  const yourLength = yourNormalized.replace(/\s+/g, '').length;
  const theirLength = theirNormalized.replace(/\s+/g, '').length;
  const minLength = Math.min(yourLength, theirLength);

  if (minLength <= 4) {
    return jw >= 0.99;
  }
  if (minLength <= 6) {
    return jw >= 0.96;
  }

  return true;
}

function hasDifferentNumericTokens(
  yourNormalized: string,
  theirNormalized: string,
): boolean {
  const yourNumbers = extractNumberTokenSet(yourNormalized);
  const theirNumbers = extractNumberTokenSet(theirNormalized);

  if (yourNumbers.size === 0 || theirNumbers.size === 0) {
    return false;
  }
  if (yourNumbers.size !== theirNumbers.size) {
    return true;
  }

  for (const value of yourNumbers) {
    if (!theirNumbers.has(value)) {
      return true;
    }
  }

  return false;
}

function extractNumberTokenSet(value: string): Set<string> {
  const matches = value.match(/\d+/g) ?? [];
  return new Set(matches);
}

function tokenize(value: string): string[] {
  return value
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function isRejectedPair(
  rejectedPairKeys: Set<string>,
  yourAccountId: string,
  theirAccountId: string,
): boolean {
  return rejectedPairKeys.has(buildPairKey(yourAccountId, theirAccountId));
}

function buildPairKey(yourAccountId: string, theirAccountId: string): string {
  return `${yourAccountId}:${theirAccountId}`;
}

function clampConfidence(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}
