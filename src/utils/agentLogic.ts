import type {
  OriginLocation,
  SortMode,
  Specialist,
  SuggestedPrompt,
  TravelMode,
} from '../types';
import { formatDistance, formatTravelTime } from './ranking.ts';

export interface ConversationalActionMatch {
  kind:
    | 'compare'
    | 'filter_open'
    | 'sort_change'
    | 'mode_change'
    | 'sync_select'
    | 'provider_qa'
    | 'general_qa';
  targetIds?: string[];
  sortMode?: SortMode;
  travelMode?: TravelMode;
  focusId?: string;
}

const EXPLICIT_RANK_PATTERNS: Array<{ pattern: RegExp; idx: number }> = [
  { pattern: /(?:^|[^a-z0-9])(?:#1|number\s+1|option\s+1)(?:$|[^a-z0-9])/i, idx: 0 },
  { pattern: /(?:^|[^a-z0-9])(?:#2|number\s+2|option\s+2)(?:$|[^a-z0-9])/i, idx: 1 },
  { pattern: /(?:^|[^a-z0-9])(?:#3|number\s+3|option\s+3)(?:$|[^a-z0-9])/i, idx: 2 },
  { pattern: /(?:^|[^a-z0-9])(?:#4|number\s+4|option\s+4)(?:$|[^a-z0-9])/i, idx: 3 },
];

const NON_PROVIDER_ORDINAL_NOUN =
  '(?:visit|appointment|time|checkup|consultation|cleaning|exam|examination|day|week|month|year|step|opinion|session|aid|priority|question|thing|name|impression|trimester|class|stage|phase|line|choice\\s+of\\s+treatment)';

const WORD_ORDINAL_PATTERNS: Array<{ pattern: RegExp; idx: number }> = [
  { pattern: new RegExp(`(?<!in the )\\b(?:first|1st)\\b(?!\\s+${NON_PROVIDER_ORDINAL_NOUN}\\b)`, 'i'), idx: 0 },
  { pattern: new RegExp(`\\b(?:second|2nd)\\b(?!\\s+${NON_PROVIDER_ORDINAL_NOUN}\\b)`, 'i'), idx: 1 },
  { pattern: new RegExp(`\\b(?:third|3rd)\\b(?!\\s+${NON_PROVIDER_ORDINAL_NOUN}\\b)`, 'i'), idx: 2 },
  { pattern: new RegExp(`\\b(?:fourth|4th)\\b(?!\\s+${NON_PROVIDER_ORDINAL_NOUN}\\b)`, 'i'), idx: 3 },
];

/**
 * Finds specialist IDs explicitly referenced by name or rank ordinal (#1, #2, "first", etc.).
 */
export function findReferencedSpecialists(
  message: string,
  specialists: Specialist[]
): Specialist[] {
  if (!specialists.length) return [];
  const lower = message.toLowerCase();
  const matched: Specialist[] = [];
  const seen = new Set<string>();

  const add = (s: Specialist | undefined) => {
    if (s && !seen.has(s.id)) {
      seen.add(s.id);
      matched.push(s);
    }
  };

  // 1. Direct name matching (exact or strong multi-word token match)
  for (const s of specialists) {
    const cleanName = s.name.toLowerCase();
    if (lower.includes(cleanName)) {
      add(s);
      continue;
    }
    const tokens = cleanName
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 4 && !['dental', 'dentist', 'clinic', 'center', 'group', 'medical', 'health', 'care', 'associates', 'san', 'francisco'].includes(t));
    if (tokens.length > 0 && tokens.some((tok) => new RegExp(`\\b${tok}\\b`, 'i').test(lower))) {
      add(s);
    }
  }

  // 2. Ordinal / rank references (#1, #2, "option 1", "first and second")
  for (const { pattern, idx } of EXPLICIT_RANK_PATTERNS) {
    if (pattern.test(lower) && specialists[idx]) {
      add(specialists[idx]);
    }
  }
  for (const { pattern, idx } of WORD_ORDINAL_PATTERNS) {
    if (pattern.test(lower) && specialists[idx]) {
      add(specialists[idx]);
    }
  }

  return matched;
}

/**
 * Detects fast follow-up agent actions on an active specialist result set
 * (comparing options, filtering open now, switching sort/travel mode,
 * shortlisting to Google Maps, or inspecting a specific provider).
 * Returns null if the message looks like a brand-new search or location change.
 */
export function detectConversationalAction(
  message: string,
  currentSpecialists: Specialist[],
  currentTravelMode: TravelMode
): ConversationalActionMatch | null {
  if (!currentSpecialists || currentSpecialists.length === 0) {
    return null;
  }

  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();

  // If user is clearly asking for a different city/location, treat as a fresh search
  if (/\b(?:near|in|around)\s+[a-z]{3,}/i.test(trimmed) && !/\b(?:in|near)\s+(?:walking|driving|biking|the\s+list|these|them)\b/i.test(trimmed)) {
    return null;
  }

  // If user asks for a totally different specialty, treat as a fresh search
  const newSpecialtyPattern =
    /\b(?:orthodontist|dermatologist|optometrist|ophthalmologist|pediatrician|cardiologist|chiropractor|therapist|psychiatrist|podiatrist|allergist|urologist|gynecologist|obgyn|endodontist|periodontist|prosthodontist|oral surgeon|urgent care|primary care|doctor|dentist)\b/i;
  const activeSpecialtyLower = (currentSpecialists[0]?.specialty || '').toLowerCase();
  const specMatch = trimmed.match(newSpecialtyPattern);
  if (
    specMatch &&
    !activeSpecialtyLower.includes(specMatch[0].toLowerCase().slice(0, 5)) &&
    !/\b(?:compare|reviews?|hours?|open|select|add|sync|faster|fastest|closest|walking|biking|driving)\b/i.test(trimmed)
  ) {
    return null;
  }

  const referenced = findReferencedSpecialists(trimmed, currentSpecialists);

  // 1. Compare action ("compare top 2", "compare #1 and #3", "which is better between...")
  if (
    /\b(?:compare|comparison|versus|vs\.?|side by side|stack up|difference between|which (?:one )?is better)\b/i.test(
      lower
    )
  ) {
    const topNMatch = lower.match(/\btop\s*(\d)\b/);
    const count = topNMatch ? Math.min(Math.max(Number(topNMatch[1]), 2), 4) : 3;
    const targets =
      referenced.length >= 2
        ? referenced.slice(0, 3)
        : currentSpecialists.slice(0, Math.min(count, currentSpecialists.length));
    return {
      kind: 'compare',
      targetIds: targets.map((s) => s.id),
      focusId: targets[0]?.id,
    };
  }

  // 2. Select / shortlist to Google Maps via natural language
  if (
    /\b(?:select|shortlist|sync|add|pick|save)\b/i.test(lower) &&
    /\b(?:top|map|maps|sync|shortlist|list|#\d|first|second|third|all|these|them)\b/i.test(lower)
  ) {
    const topNMatch = lower.match(/\btop\s*(\d)\b/);
    const count = topNMatch ? Math.min(Math.max(Number(topNMatch[1]), 1), 5) : 3;
    const targets =
      referenced.length > 0
        ? referenced
        : currentSpecialists.slice(0, Math.min(count, currentSpecialists.length));
    return {
      kind: 'sync_select',
      targetIds: targets.map((s) => s.id),
      focusId: targets[0]?.id,
    };
  }

  // 3. Filter for open right now
  if (
    /\b(?:open\s+now|open\s+right\s+now|currently\s+open|still\s+open|open\s+today)\b/i.test(
      lower
    ) &&
    referenced.length === 0
  ) {
    const openOnes = currentSpecialists.filter((s) => s.openNow === true);
    return {
      kind: 'filter_open',
      targetIds: openOnes.map((s) => s.id),
      focusId: openOnes[0]?.id,
    };
  }

  // 4. Switch travel mode ("switch to walking", "what if I walk?", "by bike")
  if (/\b(?:walk|walking|on foot)\b/i.test(lower) && currentTravelMode !== 'WALK') {
    return { kind: 'mode_change', travelMode: 'WALK' };
  }
  if (/\b(?:bike|biking|cycling|bicycle)\b/i.test(lower) && currentTravelMode !== 'BICYCLE') {
    return { kind: 'mode_change', travelMode: 'BICYCLE' };
  }
  if (/\b(?:drive|driving|by car)\b/i.test(lower) && currentTravelMode !== 'DRIVE') {
    return { kind: 'mode_change', travelMode: 'DRIVE' };
  }

  // 5. Re-rank / sort existing results ("fastest", "closest", "highest rated")
  if (
    /\b(?:fastest|closest|nearest|shortest\s+(?:drive|walk|bike|trip|travel|commute)|quickest)\b/i.test(
      lower
    ) &&
    referenced.length === 0
  ) {
    return { kind: 'sort_change', sortMode: 'fastest' };
  }
  if (
    /\b(?:highest\s+rated|top\s+rated|best\s+rated|most\s+reviews|best\s+reviews)\b/i.test(
      lower
    ) &&
    referenced.length === 0
  ) {
    return { kind: 'sort_change', sortMode: 'rating' };
  }
  if (/\b(?:best\s+match|balanced|overall\s+best)\b/i.test(lower) && referenced.length === 0) {
    return { kind: 'sort_change', sortMode: 'balanced' };
  }

  // 6. Specific provider spotlight / Q&A ("tell me about SOMA Dental", "what are #1's hours", "reviews for #2")
  if (referenced.length === 1) {
    return {
      kind: 'provider_qa',
      focusId: referenced[0].id,
      targetIds: [referenced[0].id],
    };
  }

  // 7. General or open-ended question about the current set (reviews, hours, anxiety, insurance, recommendations, or any question without a new city/specialty)
  if (
    /\b(?:hours?|weekend|saturday|sunday|review|reviews|say|accessible|wheelchair|phone|call|website|parking|anxious|gentle|recommend|best\s+for|which\s+one|why\s+is|tell\s+me\s+more|bring|prepare|expect|difference|worth|kid|kids|child|children|emergency|pain|insurance|cost|price)\b/i.test(
      lower
    ) ||
    trimmed.endsWith('?') ||
    /^(?:what|which|why|how|should|can|do|does|is|are|would|could|who)\b/i.test(lower)
  ) {
    return {
      kind: 'general_qa',
      focusId: currentSpecialists[0]?.id,
      targetIds: currentSpecialists.slice(0, 3).map((s) => s.id),
    };
  }

  return null;
}

/**
 * Detects standalone open-ended healthcare/specialist questions (before any search has run)
 * so the agent answers succinctly instead of forcing a location prompt prematurely.
 */
export function isStandaloneOpenEndedQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();

  // If user explicitly includes a location phrase ("near San Francisco", "in Brooklyn"), treat as a search
  if (/\b(?:near|in|around)\s+[a-z]{3,}/i.test(trimmed)) {
    return false;
  }

  // Explicit advice, comparison between specialist types, or preparation questions
  if (
    /\b(?:difference between|vs\.?|versus|should i see|which specialist|what kind of (?:doctor|dentist|specialist)|what should i (?:ask|look for|bring|expect)|how do i (?:choose|pick|find|prepare)|when should i see|do i need a|is it better to see)\b/i.test(
      lower
    )
  ) {
    return true;
  }

  // General question without explicit "find/search/nearby" intent
  if (
    (trimmed.endsWith('?') || /^(?:what|why|how|should|when|can|do|does|is|are)\b/i.test(lower)) &&
    !/\b(?:find|search|show|list|nearby|near me|closest|fastest|open now|open today)\b/i.test(lower)
  ) {
    return true;
  }

  return false;
}

/**
 * Extracts today's hours string from Google Places `weekdayDescriptions`, if present.
 */
export function getTodayHoursSummary(
  weekdayDescriptions?: string[],
  date: Date = new Date()
): string | null {
  if (!weekdayDescriptions || weekdayDescriptions.length === 0) return null;
  const dayNames = [
    'Sunday',
    'Monday',
    'Tuesday',
    'Wednesday',
    'Thursday',
    'Friday',
    'Saturday',
  ];
  const today = dayNames[date.getDay()];
  const match = weekdayDescriptions.find((line) =>
    line.toLowerCase().startsWith(today.toLowerCase())
  );
  if (!match) return weekdayDescriptions[0] ?? null;
  // Strip leading "Monday: " prefix for compact display
  const colonIdx = match.indexOf(':');
  return colonIdx >= 0 ? match.slice(colonIdx + 1).trim() : match;
}

/**
 * Generates contextual, natural-language guided follow-up buttons based on current results & state.
 */
export function buildContextualFollowUps(opts: {
  origin: OriginLocation | null;
  specialists: Specialist[];
  travelMode: TravelMode;
  actionJustTaken: string;
  syncedCount: number;
}): SuggestedPrompt[] {
  const { origin, specialists, travelMode, actionJustTaken, syncedCount } = opts;

  if (!origin && specialists.length === 0) {
    return [
      {
        label: 'Dentist in San Francisco',
        prompt: 'Find a top-rated dentist near San Francisco, CA with a quick drive',
      },
      {
        label: 'Dermatologist in Brooklyn',
        prompt: 'Who is the best dermatologist near Brooklyn, NY?',
      },
      {
        label: 'Optometrist in Austin',
        prompt: 'Find a highly rated optometrist near Austin, TX',
      },
    ];
  }

  if (origin && specialists.length === 0) {
    return [
      {
        label: 'Top-rated dentist nearby',
        prompt: `Find a top-rated dentist near ${origin.label}`,
      },
      {
        label: 'Dermatologist open today',
        prompt: `Find a dermatologist near ${origin.label} open today`,
      },
      {
        label: 'Optometrist with short travel',
        prompt: `Find the fastest high-rated optometrist near ${origin.label}`,
      },
    ];
  }

  const prompts: SuggestedPrompt[] = [];
  const top = specialists[0];
  const hasOpen = specialists.some((s) => s.openNow === true);

  if (actionJustTaken !== 'compare' && specialists.length >= 2) {
    prompts.push({
      label: 'Compare top 3',
      prompt: 'Compare the top 3 options side by side',
    });
  }

  if (actionJustTaken !== 'filter_open' && hasOpen) {
    prompts.push({
      label: 'Which are open now?',
      prompt: 'Which of these are open right now?',
    });
  }

  if (actionJustTaken !== 'provider_qa' && top) {
    const shortName = top.name.length > 22 ? `${top.name.slice(0, 21)}…` : top.name;
    prompts.push({
      label: `Hours & reviews for ${shortName}`,
      prompt: `Tell me about ${top.name}'s hours, reviews, and details`,
    });
  }

  if (travelMode !== 'WALK') {
    prompts.push({
      label: 'Check walking times',
      prompt: 'Re-rank these for walking instead',
    });
  } else {
    prompts.push({
      label: 'Switch to driving',
      prompt: 'Switch to driving travel times',
    });
  }

  if (syncedCount === 0 && specialists.length >= 2 && prompts.length < 3) {
    prompts.push({
      label: 'Shortlist top 2 for Maps',
      prompt: 'Select the top 2 options to sync to Google Maps',
    });
  }

  return prompts.slice(0, 3);
}

/**
 * Synthesizes a clean, factual provider-grounded answer when the Gemini model is unavailable
 * or for instantaneous deterministic actions (sort, filter, shortlist confirmation).
 */
export function buildDeterministicAgentReply(opts: {
  action: 'compare' | 'filter_open' | 'sort_change' | 'sync_select' | 'provider_qa' | 'search';
  specialists: Specialist[];
  origin: OriginLocation | null;
  travelMode: TravelMode;
  specialistQuery?: string | null;
  sortMode?: SortMode;
  focused?: Specialist | null;
}): string {
  const { action, specialists, origin, travelMode, specialistQuery, sortMode, focused } = opts;
  const modeWord =
    travelMode === 'WALK' ? 'walk' : travelMode === 'BICYCLE' ? 'bike ride' : 'drive';

  if (action === 'sync_select') {
    const names = specialists.map((s) => s.name);
    if (names.length === 1) {
      return `Added ${names[0]} below. Select "Open in Google Maps" when ready.`;
    }
    return `Added ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} below. Select "Open in Google Maps" for a multi-stop route.`;
  }

  if (action === 'filter_open') {
    if (specialists.length === 0) {
      return 'None of these options are open right now. Check each card for upcoming hours.';
    }
    const bestOpen = specialists[0];
    const hours = getTodayHoursSummary(bestOpen.weekdayDescriptions);
    return `${specialists.length} options are open now. ${bestOpen.name} leads at ${bestOpen.rating?.toFixed(1) ?? 'N/A'}★ and a ${formatTravelTime(bestOpen.travelDurationSeconds)} ${modeWord}${hours ? ` (${hours})` : ''}.`;
  }

  if (action === 'compare' && specialists.length >= 2) {
    const [a, b] = specialists;
    const faster =
      (a.travelDurationSeconds ?? Infinity) <= (b.travelDurationSeconds ?? Infinity) ? a : b;
    const higherRated = (a.rating ?? 0) >= (b.rating ?? 0) ? a : b;
    if (faster.id === higherRated.id) {
      return `${faster.name} leads on both travel (${formatTravelTime(faster.travelDurationSeconds)} ${modeWord}) and rating (${faster.rating?.toFixed(1) ?? 'N/A'}★).`;
    }
    return `${faster.name} is quickest (${formatTravelTime(faster.travelDurationSeconds)} ${modeWord}, ${formatDistance(faster.distanceMeters)}), while ${higherRated.name} leads on rating (${higherRated.rating?.toFixed(1) ?? 'N/A'}★).`;
  }

  if (action === 'provider_qa' && focused) {
    const hours = getTodayHoursSummary(focused.weekdayDescriptions);
    const reviewNote = focused.reviews?.[0]?.text
      ? ` Review: "${focused.reviews[0].text.slice(0, 120)}${focused.reviews[0].text.length > 120 ? '…' : ''}"`
      : '';
    const status =
      focused.openNow === true
        ? 'Open now'
        : focused.openNow === false
          ? 'Closed now'
          : 'Hours below';
    return `${focused.name}: ${focused.rating?.toFixed(1) ?? 'N/A'}★, ${formatTravelTime(focused.travelDurationSeconds)} ${modeWord}. ${status}${hours ? ` (${hours})` : ''}.${reviewNote}`;
  }

  if (action === 'sort_change' && specialists.length > 0) {
    const top = specialists[0];
    const modeDesc =
      sortMode === 'fastest'
        ? 'shortest trip'
        : sortMode === 'rating'
          ? 'highest rating'
          : 'best overall balance';
    return `Ranked by ${modeDesc}. ${top.name} is #1 (${top.rating?.toFixed(1) ?? 'N/A'}★, ${formatTravelTime(top.travelDurationSeconds)} ${modeWord}).`;
  }

  if (specialists.length > 0) {
    const top = specialists[0];
    const openCount = specialists.filter((s) => s.openNow === true).length;
    const openSuffix = openCount > 0 ? ` (${openCount} open)` : '';
    return `Found ${specialists.length} ${specialistQuery || 'specialist'} options near ${origin?.label || 'you'}${openSuffix}. ${top.name} ranks #1 (${top.rating?.toFixed(1) ?? 'N/A'}★, ${formatTravelTime(top.travelDurationSeconds)} ${modeWord}).`;
  }

  return `No ${specialistQuery || 'specialist'} matches near ${origin?.label || 'that area'}. Try a wider search.`;
}
