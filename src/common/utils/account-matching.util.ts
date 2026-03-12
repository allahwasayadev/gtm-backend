import { Account } from '@prisma/client';
import { jaroWinkler } from './similarity.util';

export const EXACT_MATCH_CONFIDENCE = 1.0;
export const AUTO_RESOLVE_THRESHOLD = 0.96;
export const SUGGEST_MIN_THRESHOLD = 0.85;
export const SUGGEST_MAX_THRESHOLD = 0.92;
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

const LOW_SIGNAL_TOKENS = new Set(['and', 'of']);
const GENERIC_SHORT_VALUES = new Set([
  'co',
  'it',
  'us',
  'uk',
  'eu',
  'ai',
  'hr',
  'tv',
  'pc',
  'id',
  'am',
  'pm',
]);
const GENERIC_CONTAINED_ALIAS_TOKENS = new Set([
  'group',
  'holding',
  'holdings',
  'systems',
  'solutions',
  'services',
  'technology',
  'technologies',
  'software',
  'security',
  'healthcare',
  'communications',
  'network',
  'networks',
  'financial',
  'insurance',
  'bank',
  'energy',
  'global',
  'international',
]);
const SAFE_COMPACT_ALIAS_MAP: Record<string, string[]> = {
  atandt: ['att'],
};

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
    if (!theirAccount.normalizedName?.trim()) {
      continue;
    }
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
    if (!yourAccount.normalizedName?.trim()) {
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
  if (!yourNormalized?.trim() || !theirNormalized?.trim()) {
    return { confidence: 0, matchType: null };
  }

  if (hasDifferentNumericTokens(yourNormalized, theirNormalized)) {
    return { confidence: 0, matchType: null };
  }

  const acronymEvaluation = evaluateAcronymLikeMatch(
    yourNormalized,
    theirNormalized,
  );
  if (acronymEvaluation) {
    return acronymEvaluation;
  }
  const containedBrandEvaluation = evaluateContainedBrandTokenMatch(
    yourNormalized,
    theirNormalized,
  );
  if (containedBrandEvaluation) {
    return containedBrandEvaluation;
  }

  const jw = jaroWinkler(yourNormalized, theirNormalized);
  const tokenScores = calculateTokenScores(yourNormalized, theirNormalized);
  const sharedTokenLength = longestSharedMeaningfulTokenLength(
    yourNormalized,
    theirNormalized,
  );

  const primaryGuardPassed = passesTokenGuard(tokenScores, jw);
  const suggestionBypass =
    !primaryGuardPassed &&
    tokenScores.overlapCount >= 1 &&
    tokenScores.tokenContainment >= 0.5 &&
    sharedTokenLength >= 5 &&
    jw >= 0.85;

  if (!primaryGuardPassed && !suggestionBypass) {
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

  const relaxedPasses = passesSuggestionGuardRelaxed(
    yourNormalized,
    theirNormalized,
    tokenScores,
    jw,
    sharedTokenLength,
  );
  const suggestThreshold =
    suggestionBypass && relaxedPasses ? 0.8 : SUGGEST_MIN_THRESHOLD;

  const highConfidenceFallback =
    jw >= 0.92 &&
    tokenScores.overlapCount >= 1 &&
    tokenScores.tokenContainment >= 0.5;

  if (
    confidence >= suggestThreshold &&
    confidence <= SUGGEST_MAX_THRESHOLD &&
    (passesSuggestionGuard(yourNormalized, theirNormalized, tokenScores, jw) ||
      (suggestionBypass && relaxedPasses) ||
      highConfidenceFallback)
  ) {
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
  const yourTokens = new Set(tokenizeMeaningful(yourNormalized));
  const theirTokens = new Set(tokenizeMeaningful(theirNormalized));

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
  if (tokenScores.tokenContainment < 0.5) {
    return false;
  }
  if (tokenScores.tokenContainment < 0.67 && tokenScores.tokenJaccard < 0.4) {
    return false;
  }
  if (jw < 0.82 && tokenScores.tokenContainment < 0.75) {
    return false;
  }

  return true;
}

function passesAutoResolveGuard(tokenScores: TokenScores, jw: number): boolean {
  return (
    jw >= 0.92 &&
    tokenScores.tokenContainment >= 0.75 &&
    tokenScores.tokenJaccard >= 0.5
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
    return jw >= 0.995;
  }
  if (minLength <= 6) {
    return jw >= 0.98;
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

function tokenizeMeaningful(value: string): string[] {
  const meaningful = tokenize(value).filter(
    (token) => !LOW_SIGNAL_TOKENS.has(token),
  );
  return meaningful.length > 0 ? meaningful : tokenize(value);
}

function evaluateAcronymLikeMatch(
  yourNormalized: string,
  theirNormalized: string,
): CandidateMatchEvaluation | null {
  const yourCompact = compact(yourNormalized);
  const theirCompact = compact(theirNormalized);
  if (!yourCompact || !theirCompact) {
    return null;
  }

  const [shortValue, longValue] =
    yourCompact.length <= theirCompact.length
      ? [yourNormalized, theirNormalized]
      : [theirNormalized, yourNormalized];
  const shortCompact = compact(shortValue);
  const longCompact = compact(longValue);

  if (!shortCompact || !longCompact) {
    return null;
  }
  if (shortCompact.length > 4 || shortCompact.length >= longCompact.length) {
    return null;
  }
  if (GENERIC_SHORT_VALUES.has(shortCompact)) {
    return { confidence: 0, matchType: null };
  }

  const longTokens = tokenizeMeaningful(longValue);
  if (longTokens.length < 2) {
    return null;
  }

  const longAcronym = longTokens.map((token) => token[0]).join('');
  const longCompactMeaningful = longTokens.join('');
  const safeAliases = new Set([
    ...(SAFE_COMPACT_ALIAS_MAP[longCompact] ?? []),
    ...(SAFE_COMPACT_ALIAS_MAP[longCompactMeaningful] ?? []),
  ]);

  const isAcronymMatch = shortCompact === longAcronym;
  const isCompactMatch = shortCompact === longCompactMeaningful;
  const isSafeAliasMatch = safeAliases.has(shortCompact);

  if (!isAcronymMatch && !isCompactMatch && !isSafeAliasMatch) {
    return { confidence: 0, matchType: null };
  }

  return {
    confidence: isAcronymMatch ? 0.985 : 0.97,
    matchType: 'auto',
  };
}

function evaluateContainedBrandTokenMatch(
  yourNormalized: string,
  theirNormalized: string,
): CandidateMatchEvaluation | null {
  const yourTokens = tokenizeMeaningful(yourNormalized);
  const theirTokens = tokenizeMeaningful(theirNormalized);

  const [shortTokens, longTokens] =
    yourTokens.length <= theirTokens.length
      ? [yourTokens, theirTokens]
      : [theirTokens, yourTokens];

  if (
    shortTokens.length !== 1 ||
    longTokens.length < 2 ||
    longTokens.length > 3
  ) {
    return null;
  }

  const brandToken = shortTokens[0];
  if (!brandToken || brandToken.length < 5) {
    return null;
  }
  if (GENERIC_CONTAINED_ALIAS_TOKENS.has(brandToken)) {
    return { confidence: 0, matchType: null };
  }

  const brandTokenIndex = longTokens.indexOf(brandToken);
  if (brandTokenIndex === -1) {
    return null;
  }
  const isTrailingBrand = brandTokenIndex === longTokens.length - 1;
  const isAmazonStyleDotComVariant =
    longTokens.length === 2 && brandTokenIndex === 0 && longTokens[1] === 'com';

  if (!isTrailingBrand && !isAmazonStyleDotComVariant) {
    return { confidence: 0, matchType: null };
  }

  return {
    confidence: 0.965,
    matchType: 'auto',
  };
}

function passesSuggestionGuard(
  yourNormalized: string,
  theirNormalized: string,
  tokenScores: TokenScores,
  jw: number,
): boolean {
  if (jw < 0.88) {
    return false;
  }
  if (tokenScores.tokenContainment < 0.67) {
    return false;
  }

  const sharedTokenLength = longestSharedMeaningfulTokenLength(
    yourNormalized,
    theirNormalized,
  );
  if (tokenScores.overlapCount === 1 && sharedTokenLength < 5) {
    return false;
  }

  return true;
}

function passesSuggestionGuardRelaxed(
  yourNormalized: string,
  theirNormalized: string,
  tokenScores: TokenScores,
  jw: number,
  sharedTokenLength: number,
): boolean {
  if (jw < 0.85) {
    return false;
  }
  if (tokenScores.overlapCount !== 1) {
    return false;
  }
  if (sharedTokenLength < 5) {
    return false;
  }
  if (tokenScores.tokenContainment < 0.5) {
    return false;
  }
  return true;
}

function longestSharedMeaningfulTokenLength(a: string, b: string): number {
  const aTokens = new Set(tokenizeMeaningful(a));
  const bTokens = new Set(tokenizeMeaningful(b));
  let longest = 0;

  for (const token of aTokens) {
    if (bTokens.has(token)) {
      longest = Math.max(longest, token.length);
    }
  }

  return longest;
}

function compact(value: string): string {
  return value.replace(/\s+/g, '');
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
