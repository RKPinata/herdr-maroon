// File-name ranking of VS Code's quick open, ported from src/vs/base/common/fuzzyScorer.ts (MIT, Microsoft,
// commit f6c56f75d0f9ff0774c14303046f43acfde240f3): prepareQuery, scoreFuzzy, item scoring over a label (the file
// name) and a description (its folder), and compareItemsByFuzzyScore. Paths use "/". Matches are [start, end) pairs. Pure.

const NO_MATCH = 0;
const PATH_IDENTITY_SCORE = 1 << 18;
const LABEL_PREFIX_SCORE_THRESHOLD = 1 << 17;
const LABEL_SCORE_THRESHOLD = 1 << 16;
const NO_ITEM_SCORE = Object.freeze({ score: 0, labelMatch: [], descriptionMatch: [] });

// [score, positions]: positions are the target indexes the query characters matched, in order.
export function scoreFuzzy(target, query, queryLower, allowNonContiguousMatches) {
  if (!target || !query) return [NO_MATCH, []];
  const targetLength = target.length, queryLength = query.length;
  if (targetLength < queryLength) return [NO_MATCH, []];
  return doScoreFuzzy(query, queryLower, queryLength, target, target.toLowerCase(), targetLength, allowNonContiguousMatches);
}

function doScoreFuzzy(query, queryLower, queryLength, target, targetLower, targetLength, allowNonContiguousMatches) {
  const scores = new Int32Array(queryLength * targetLength);
  const matches = new Int32Array(queryLength * targetLength);
  for (let queryIndex = 0; queryIndex < queryLength; queryIndex++) {
    const queryIndexOffset = queryIndex * targetLength;
    const queryIndexPreviousOffset = queryIndexOffset - targetLength;
    const queryIndexGtNull = queryIndex > 0;
    const queryCharAtIndex = query[queryIndex];
    const queryLowerCharAtIndex = queryLower[queryIndex];
    for (let targetIndex = 0; targetIndex < targetLength; targetIndex++) {
      const targetIndexGtNull = targetIndex > 0;
      const currentIndex = queryIndexOffset + targetIndex;
      const leftIndex = currentIndex - 1;
      const diagIndex = queryIndexPreviousOffset + targetIndex - 1;
      const leftScore = targetIndexGtNull ? scores[leftIndex] : 0;
      const diagScore = queryIndexGtNull && targetIndexGtNull ? scores[diagIndex] : 0;
      const matchesSequenceLength = queryIndexGtNull && targetIndexGtNull ? matches[diagIndex] : 0;
      const score = !diagScore && queryIndexGtNull ? 0
        : computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength);
      const isValidScore = score && diagScore + score >= leftScore;
      if (isValidScore && (allowNonContiguousMatches || queryIndexGtNull || targetLower.startsWith(queryLower, targetIndex))) {
        matches[currentIndex] = matchesSequenceLength + 1;
        scores[currentIndex] = diagScore + score;
      } else {
        matches[currentIndex] = NO_MATCH;
        scores[currentIndex] = leftScore;
      }
    }
  }
  const positions = [];
  let queryIndex = queryLength - 1, targetIndex = targetLength - 1;
  while (queryIndex >= 0 && targetIndex >= 0) {
    if (matches[queryIndex * targetLength + targetIndex] === NO_MATCH) targetIndex--;
    else { positions.push(targetIndex); queryIndex--; targetIndex--; }
  }
  return [scores[queryLength * targetLength - 1], positions.reverse()];
}

function computeCharScore(queryCharAtIndex, queryLowerCharAtIndex, target, targetLower, targetIndex, matchesSequenceLength) {
  if (!considerAsEqual(queryLowerCharAtIndex, targetLower[targetIndex])) return 0;
  let score = 1;
  if (matchesSequenceLength > 0) score += Math.min(matchesSequenceLength, 3) * 6 + Math.max(0, matchesSequenceLength - 3) * 3;
  if (queryCharAtIndex === target[targetIndex]) score += 1;
  if (targetIndex === 0) score += 8;
  else {
    const separatorBonus = scoreSeparatorAtPos(target.charCodeAt(targetIndex - 1));
    if (separatorBonus) score += separatorBonus;
    else if (isUpper(target.charCodeAt(targetIndex)) && matchesSequenceLength === 0) score += 2;
  }
  return score;
}

function considerAsEqual(a, b) {
  if (a === b) return true;
  if (a === "/" || a === "\\") return b === "/" || b === "\\";
  return false;
}

const isUpper = (code) => code >= 65 && code <= 90;

function scoreSeparatorAtPos(code) {
  if (code === 47 || code === 92) return 5; // / \
  if (code === 95 || code === 45 || code === 46 || code === 32 || code === 39 || code === 34 || code === 58) return 4; // _ - . space ' " :
  return 0;
}

// filters.ts matchesPrefix, ignoring case.
function matchesPrefix(word, target) {
  if (!target || target.length < word.length) return null;
  return target.toLowerCase().startsWith(word.toLowerCase()) ? [[0, word.length]] : null;
}

function createMatches(offsets) {
  const ret = [];
  let last = null;
  for (const pos of offsets ?? []) {
    if (last && last[1] === pos) last[1] += 1;
    else { last = [pos, pos + 1]; ret.push(last); }
  }
  return ret;
}

function normalizeMatches(matches) {
  const out = [];
  let current = null;
  for (const m of [...matches].sort((a, b) => a[0] - b[0])) {
    if (!current || current[1] < m[0] || m[1] < current[0]) { current = [m[0], m[1]]; out.push(current); }
    else { current[0] = Math.min(current[0], m[0]); current[1] = Math.max(current[1], m[1]); }
  }
  return out;
}

const queryExpectsExactMatch = (q) => q.startsWith('"') && q.endsWith('"');

function normalizeQuery(original) {
  const pathNormalized = original.replace(/\\/g, "/");
  const normalized = pathNormalized.replace(/[*…\s"]/g, "").replace(/(?<=.)#$/, "");
  return { pathNormalized, normalized, normalizedLowercase: normalized.toLowerCase() };
}

// The query as the scorer uses it; words split on spaces become `values`, and every word must match.
export function prepareQuery(original) {
  if (typeof original !== "string") original = "";
  const { pathNormalized, normalized, normalizedLowercase } = normalizeQuery(original);
  let values;
  const split = original.split(" ");
  if (split.length > 1) {
    for (const piece of split) {
      const n = normalizeQuery(piece);
      if (n.normalized) (values ??= []).push({ original: piece, ...n, expectContiguousMatch: queryExpectsExactMatch(piece) });
    }
  }
  return { original, pathNormalized, normalized, normalizedLowercase, values, containsPathSeparator: pathNormalized.includes("/"), expectContiguousMatch: queryExpectsExactMatch(original) };
}

// { score, labelMatch, descriptionMatch }: label is the file name, description its folder, path the whole relative
// path. score 0 means no match. A query with "/" is matched against folder/name instead of the name first.
export function scoreItem(label, description, path, query) {
  if (!query.normalized) return NO_ITEM_SCORE;
  const preferLabelMatches = !path || !query.containsPathSeparator;
  if (path && query.pathNormalized.toLowerCase() === path.toLowerCase()) {
    return { score: PATH_IDENTITY_SCORE, labelMatch: [[0, label.length]], descriptionMatch: description ? [[0, description.length]] : [] };
  }
  if (query.values && query.values.length > 1) {
    let total = 0;
    const labelMatches = [], descriptionMatches = [];
    for (const piece of query.values) {
      const s = scoreSingle(label, description, path, piece, preferLabelMatches);
      if (s.score === NO_MATCH) return NO_ITEM_SCORE;
      total += s.score;
      labelMatches.push(...s.labelMatch);
      descriptionMatches.push(...s.descriptionMatch);
    }
    return { score: total, labelMatch: normalizeMatches(labelMatches), descriptionMatch: normalizeMatches(descriptionMatches) };
  }
  return scoreSingle(label, description, path, query, preferLabelMatches);
}

function scoreSingle(label, description, path, query, preferLabelMatches) {
  const allowNonContiguous = !query.expectContiguousMatch;
  if (preferLabelMatches || !description) {
    const [labelScore, labelPositions] = scoreFuzzy(label, query.normalized, query.normalizedLowercase, allowNonContiguous);
    if (labelScore) {
      const prefix = matchesPrefix(query.normalized, label);
      const base = prefix ? LABEL_PREFIX_SCORE_THRESHOLD + Math.round((query.normalized.length / label.length) * 100) : LABEL_SCORE_THRESHOLD;
      return { score: base + labelScore, labelMatch: prefix ?? createMatches(labelPositions), descriptionMatch: [] };
    }
  }
  if (description) {
    const descriptionPrefix = path ? `${description}/` : description;
    const prefixLength = descriptionPrefix.length;
    const [score, positions] = scoreFuzzy(`${descriptionPrefix}${label}`, query.normalized, query.normalizedLowercase, allowNonContiguous);
    if (score) {
      const labelMatch = [], descriptionMatch = [];
      for (const [start, end] of createMatches(positions)) {
        if (start < prefixLength && end > prefixLength) { labelMatch.push([0, end - prefixLength]); descriptionMatch.push([start, prefixLength]); }
        else if (start >= prefixLength) labelMatch.push([start - prefixLength, end - prefixLength]);
        else descriptionMatch.push([start, end]);
      }
      return { score, labelMatch, descriptionMatch };
    }
  }
  return NO_ITEM_SCORE;
}

// Sort order of two scored items { label, description, path, score: scoreItem(...) }: negative puts a first.
export function compareItems(a, b, query) {
  const sa = a.score, sb = b.score, scoreA = sa.score, scoreB = sb.score;
  if ((scoreA === PATH_IDENTITY_SCORE || scoreB === PATH_IDENTITY_SCORE) && scoreA !== scoreB) return scoreA === PATH_IDENTITY_SCORE ? -1 : 1;
  if (scoreA > LABEL_SCORE_THRESHOLD || scoreB > LABEL_SCORE_THRESHOLD) {
    if (scoreA !== scoreB) return scoreA > scoreB ? -1 : 1;
    if (scoreA < LABEL_PREFIX_SCORE_THRESHOLD && scoreB < LABEL_PREFIX_SCORE_THRESHOLD) {
      const byLength = compareByMatchLength(sa.labelMatch, sb.labelMatch);
      if (byLength !== 0) return byLength;
    }
    if (a.label.length !== b.label.length) return a.label.length - b.label.length;
  }
  if (scoreA !== scoreB) return scoreA > scoreB ? -1 : 1;
  const aLabel = sa.labelMatch.length > 0, bLabel = sb.labelMatch.length > 0;
  if (aLabel !== bLabel) return aLabel ? -1 : 1;
  const da = matchDistance(a), db = matchDistance(b);
  if (da && db && da !== db) return db > da ? -1 : 1;
  return fallbackCompare(a, b, query);
}

function matchDistance(item) {
  const { labelMatch, descriptionMatch } = item.score;
  let start = -1, end = -1;
  if (descriptionMatch.length) start = descriptionMatch[0][0];
  else if (labelMatch.length) start = labelMatch[0][0];
  if (labelMatch.length) {
    end = labelMatch[labelMatch.length - 1][1];
    if (descriptionMatch.length && item.description) end += item.description.length;
  } else if (descriptionMatch.length) end = descriptionMatch[descriptionMatch.length - 1][1];
  return end - start;
}

function compareByMatchLength(a, b) {
  if (!a.length && !b.length) return 0;
  if (!b.length) return -1;
  if (!a.length) return 1;
  const la = a[a.length - 1][1] - a[0][0], lb = b[b.length - 1][1] - b[0][0];
  return la === lb ? 0 : lb < la ? 1 : -1;
}

function fallbackCompare(a, b, query) {
  const la = a.label.length + (a.description?.length ?? 0), lb = b.label.length + (b.description?.length ?? 0);
  if (la !== lb) return la - lb;
  if (a.path.length !== b.path.length) return a.path.length - b.path.length;
  if (a.label !== b.label) return compareAnything(a.label, b.label, query.normalized);
  if (a.description !== b.description) return compareAnything(a.description ?? "", b.description ?? "", query.normalized);
  return compareAnything(a.path, b.path, query.normalized);
}

// comparers.ts compareAnything without its file-name collation: prefix matches first (shorter first), then suffix
// matches, then plain order.
function compareAnything(a, b, lookFor) {
  const al = a.toLowerCase(), bl = b.toLowerCase(), q = lookFor.toLowerCase();
  const ap = al.startsWith(q), bp = bl.startsWith(q);
  if (ap !== bp) return ap ? -1 : 1;
  if (ap && al.length !== bl.length) return al.length - bl.length;
  const as = al.endsWith(q), bs = bl.endsWith(q);
  if (as !== bs) return as ? -1 : 1;
  return al < bl ? -1 : al > bl ? 1 : 0;
}
