import { MediaProvider, MediaType, ScriptSegment } from '../types';

const KNOWN_PUBLIC_FIGURES = [
  'Donald Trump',
  'Trump',
  'Joe Biden',
  'Biden',
  'Barack Obama',
  'Obama',
  'Vladimir Putin',
  'Putin',
  'Xi Jinping',
  'Elon Musk',
];

const REAL_WORLD_TERMS = [
  'president',
  'prime minister',
  'politician',
  'election',
  'white house',
  'congress',
  'court',
  'war',
  'protest',
  'speech',
  'interview',
  'news',
  'map',
  'document',
  'archive',
  'historical',
];

export type SearchIntent = ScriptSegment['search_intent'];

export function extractEntityNames(text: string): string[] {
  const found = new Set<string>();
  const normalized = text.toLowerCase();

  KNOWN_PUBLIC_FIGURES.forEach(name => {
    if (normalized.includes(name.toLowerCase())) {
      found.add(name === 'Trump' ? 'Donald Trump' : name === 'Biden' ? 'Joe Biden' : name === 'Obama' ? 'Barack Obama' : name === 'Putin' ? 'Vladimir Putin' : name);
    }
  });

  const titleNamePattern = /\b(?:President|Former President|Prime Minister|Senator|Governor|Mr\.|Ms\.|Dr\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})\b/g;
  for (const match of text.matchAll(titleNamePattern)) {
    found.add(match[0].replace(/^(President|Former President|Prime Minister|Senator|Governor|Mr\.|Ms\.|Dr\.)\s+/, '').trim());
  }

  return [...found].filter(Boolean);
}

export function inferSearchIntent(text: string, entityNames: string[] = []): SearchIntent {
  const normalized = text.toLowerCase();

  if (entityNames.length > 0) return 'real_person';
  if (REAL_WORLD_TERMS.some(term => normalized.includes(term))) {
    if (normalized.includes('map')) return 'place';
    if (normalized.includes('document') || normalized.includes('archive') || normalized.includes('historical')) return 'documentary';
    return 'real_event';
  }
  if (normalized.includes('abstract') || normalized.includes('symbolic') || normalized.includes('metaphor')) return 'abstract';
  return 'stock';
}

export function providerPriorityForIntent(intent: SearchIntent, mediaType: MediaType): MediaProvider[] {
  if (intent === 'real_person' || intent === 'real_event' || intent === 'documentary') {
    return mediaType === 'video'
      ? ['government', 'wikimedia', 'pexels', 'pixabay']
      : ['wikimedia', 'government', 'openverse', 'pexels', 'pixabay'];
  }

  if (intent === 'place') {
    return ['wikimedia', 'government', 'openverse', 'pexels', 'pixabay'];
  }

  return mediaType === 'video'
    ? ['pexels', 'pixabay', 'government']
    : ['pexels', 'pixabay', 'wikimedia', 'openverse', 'government'];
}

export function normalizeMediaTypeForIntent(mediaType: MediaType, intent: SearchIntent, text: string): MediaType {
  const lower = text.toLowerCase();
  const explicitMotion = /\b(video|footage|clip|walking|running|drone|moving|speech|speaking|interview|crowd|protest)\b/.test(lower);

  if ((intent === 'real_person' || intent === 'real_event' || intent === 'documentary') && !explicitMotion) {
    return 'image';
  }

  return mediaType;
}

export function buildIntentQueries(baseQueries: string[], summary: string, entityNames: string[], intent: SearchIntent) {
  const queries = baseQueries.length > 0 ? [...baseQueries] : [summary];

  if (entityNames.length === 0) return queries;

  const entityQueries = entityNames.flatMap(entity => {
    if (intent === 'real_person') {
      return [
        `${entity} portrait`,
        `${entity} speech`,
        `${entity} official photo`,
        `${entity} Wikimedia Commons`,
      ];
    }
    return [`${entity} ${summary}`, `${entity} documentary`, `${entity} archive photo`];
  });

  return [...entityQueries, ...queries.filter(query => entityNames.some(entity => query.toLowerCase().includes(entity.toLowerCase()))), ...queries]
    .filter((query, index, arr) => query && arr.findIndex(other => other.toLowerCase() === query.toLowerCase()) === index);
}
