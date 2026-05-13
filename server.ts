import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import axios from 'axios';
import * as cheerio from 'cheerio';
import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { fileURLToPath } from 'url';
import { classifyLicense } from './src/lib/licenseGate';
import { searchMediaAssets } from './src/lib/mediaProviders';
import type { MediaAsset, MediaProvider, MediaSearchRequest, MediaType } from './src/types';

dotenv.config({ path: path.join(process.cwd(), '.env.local') });
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';

let geminiClient: GoogleGenAI | null = null;
let geminiClientKey: string | undefined;

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  if (!geminiClient || geminiClientKey !== apiKey) {
    geminiClient = new GoogleGenAI({ apiKey });
    geminiClientKey = apiKey;
  }

  return geminiClient;
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stringifyError(error: unknown) {
  try {
    return JSON.stringify(error).toLowerCase();
  } catch {
    return String(error).toLowerCase();
  }
}

function isHardQuotaError(errorStr: string) {
  return errorStr.includes('resource_exhausted') ||
    errorStr.includes('quota exceeded') ||
    errorStr.includes('free_tier') ||
    errorStr.includes('generaterequestsperday') ||
    errorStr.includes('billing details');
}

async function callWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
  let lastError: unknown;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorStr = stringifyError(error);
      const isRateLimit =
        errorStr.includes('429') ||
        errorStr.includes('rate_limit') ||
        error?.status === 429 ||
        error?.code === 429;

      if (isHardQuotaError(errorStr)) {
        throw error;
      }

      if (isRateLimit && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 3000 + Math.random() * 2000;
        console.warn(`Gemini rate limit. Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await sleep(delay);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

async function generateGeminiText(prompt: string, responseMimeType?: string) {
  return callWithRetry(async () => {
    const request: any = {
      model: GEMINI_MODEL,
      contents: prompt,
    };

    if (responseMimeType) {
      request.config = { responseMimeType };
    }

    const response = await getGeminiClient().models.generateContent(request);
    return response.text || '';
  });
}

function tryFixJson(jsonStr: string): string {
  let fixed = jsonStr.trim();
  const stack: string[] = [];

  for (let i = 0; i < fixed.length; i++) {
    if (fixed[i] === '{') stack.push('}');
    else if (fixed[i] === '[') stack.push(']');
    else if ((fixed[i] === '}' || fixed[i] === ']') && stack.at(-1) === fixed[i]) stack.pop();
  }

  while (stack.length > 0) fixed += stack.pop();
  return fixed;
}

function parseGeminiJson<T>(text: string): T {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(tryFixJson(text));
  }
}

async function getGlobalContext(script: string, targetRegion?: string): Promise<string> {
  const prompt = `
Task: Analyze script for "Cinematic North Star".
Output: mood, theme, style, environment (<100 words).

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.
` : '- No explicit target region. Infer from script context and named entities.'}

STRICT VISUAL GROUNDING RULES:
1. NO HARDCODING: Do not assume any default country.
2. CONSISTENCY: Every scene must follow the same geographic logic.
3. VISUAL GEO-ALIGNMENT: All environment and character descriptions must reflect the target region.

Script: ${script}
`;

  const text = await generateGeminiText(prompt);
  return text || 'Cinematic storytelling.';
}

async function splitScriptIntoSentences(script: string, context: string): Promise<string[]> {
  const prompt = `
Task: Split the following script into individual sentences or semantic units for visual processing.
STRICT RULES:
1. DO NOT summarize, paraphrase, or omit ANY part of the original script.
2. Capture EVERY single word from the beginning to the end.
3. Every element in the array must be a coherent segment that can be visualized as a scene.
4. If a sentence is very long, split it at natural pauses (commas, conjunctions).
5. Output MUST be a pure JSON array of strings.

Context: ${context}
Script to split:
${script}
`;

  try {
    const text = await generateGeminiText(prompt, 'application/json');
    const result = parseGeminiJson<unknown>(text);
    if (!Array.isArray(result)) throw new Error('Gemini split result is not an array');
    return result.map(String).map(s => s.trim()).filter(Boolean);
  } catch (error) {
    console.error('Splitting Error:', error);
    return script.split(/[.!?]+/).map(s => s.trim()).filter(s => s.length > 2);
  }
}

async function analyzeSentence(
  sentence: string,
  sentenceId: number,
  context: string,
  languageMode: string,
  targetRegion?: string
): Promise<unknown> {
  const searchLanguageRule = languageMode === 'original'
    ? '- MEDIA QUERIES: Prefer the original script language when it improves search relevance; keep named places and cultural terms intact.'
    : '- MEDIA QUERIES: Write all media_queries in clear English for broad stock-media search coverage.';

  const prompt = `
Task: Analyze the following sentence and break it into one or more visual scenes.
Sentence #${sentenceId}: "${sentence}"

GLOBAL CONTEXT: ${context}

### TARGET REGION PRIORITY RULE ###
${targetRegion ? `
- TARGET REGION = ${targetRegion}
- This is the PRIMARY visual anchor. All ethnicity, architecture, and cultural context MUST align with this.
- characters -> must match local population of ${targetRegion}.
- architecture/streets -> must match ${targetRegion} local style.
- signage/text in visuals -> use ${targetRegion} local language.
` : '- No explicit target region. Infer from script context and named entities.'}

### MEDIA RETRIEVAL ARCHITECTURE: SEMANTIC INTENT ###
Your responsibility is strictly:
1. SEMANTIC ANALYSIS: Understand the core meaning, emotion, and narrative of the scene.
2. CINEMATIC REASONING: Decide the camera work, lighting, and composition.
3. KEYWORD GENERATION (SEARCH INTENT):
   - Provide "media_queries" as a list of 3-5 high-quality, SEMANTIC-RICH keywords.
   - Keywords MUST be context-aware, geo-aware (using the Target Region), and cinematic-aware.
   - AVOID generic terms. Use descriptive cinematic language (e.g., "cinematic wide shot of Hanoi old quarter at sunset" instead of "Vietnam street").
   - NO HALLUCINATION: Do not assume media exists or provide fake URLs.
${searchLanguageRule}
   - For real people, politicians, celebrities, organizations, real events, maps, or historical references, queries MUST include the exact entity name.
   - For any named public figure, use real-person/documentary queries such as "[exact name] portrait", "[exact name] speech", "[exact name] official photo", not generic nature or symbolic footage.
   - Do not replace named entities with metaphors, landscapes, moods, or generic stock footage.

RULES:
- If the sentence describes multiple distinct visual actions or changes, create multiple scenes.
- Decide if VIDEO (motion) or IMAGE (static) is better based on the action described.
- If the scene depends on a real person, exact event, document, map, or factual archive, prefer IMAGE unless the sentence explicitly needs motion.
- STICK TO THE ORIGINAL TEXT. DO NOT SUMMARIZE.

Output Format (STRICT JSON):
{
  "sentence_id": ${sentenceId},
  "sentence_text": "${sentence.replace(/"/g, '\\"')}",
  "vietnamese_translation": "Dịch toàn bộ câu sang tiếng Việt (mượt mà, tự nhiên)",
  "scenes": [{
    "scene_id": number,
    "visual_target": "vs_${sentenceId}_sceneindex",
    "scene_summary": "English summary for LLM context",
    "visual_meaning": "The core visual focus of this scene",
    "emotion": "Mood (e.g., Hopeful, Tense, Peaceful)",
    "style": "Cinematic/Natural/Abstract/Documentary",
    "media_type": "video" | "image",
    "search_intent": "stock" | "real_person" | "real_event" | "place" | "documentary" | "abstract",
    "entity_names": ["exact named person/place/org/event if present"],
    "keywords": ["semantic keyword 1", "semantic keyword 2"],
    "media_queries": ["contextual search query with regional grounding", "cinematic search query 2"],
    "camera_style": "Shot type (e.g., High Angle, Extreme Close Up)",
    "visual_description": "Detailed visual intention including ethnicity, environment, and focal point"
  }],
  "export_file": "${sentenceId}.txt"
}
`;

  const text = await generateGeminiText(prompt, 'application/json');
  return parseGeminiJson<unknown>(text);
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  const normalized = message.toLowerCase();

  if (isHardQuotaError(normalized)) {
    return 'Gemini quota exhausted for the current API key/model. Use another key/model, wait for quota reset, or run in an AI Studio environment with available quota.';
  }

  return message || 'Unexpected server error';
}

function getHttpStatus(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return isHardQuotaError(message.toLowerCase()) ? 429 : 500;
}

const DEFAULT_IMAGE_PROVIDERS: MediaProvider[] = ['pexels', 'pixabay', 'wikimedia', 'openverse', 'government'];
const DEFAULT_VIDEO_PROVIDERS: MediaProvider[] = ['pexels', 'pixabay', 'government'];

function parseProviders(value: unknown, mediaType: MediaType): MediaProvider[] {
  const allowed = new Set<MediaProvider>(['pexels', 'pixabay', 'wikimedia', 'openverse', 'government', 'google_unverified']);
  if (!Array.isArray(value)) {
    return mediaType === 'video' ? DEFAULT_VIDEO_PROVIDERS : DEFAULT_IMAGE_PROVIDERS;
  }

  const providers = value.filter((provider): provider is MediaProvider => allowed.has(provider));
  return providers.length > 0 ? providers : (mediaType === 'video' ? DEFAULT_VIDEO_PROVIDERS : DEFAULT_IMAGE_PROVIDERS);
}

function normalizeMediaSearchRequest(body: any): MediaSearchRequest {
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const mediaType: MediaType = body?.mediaType === 'video' ? 'video' : 'image';

  if (!query) {
    throw new Error('Query is required');
  }

  return {
    query,
    mediaType,
    aspectRatio: body?.aspectRatio === 'portrait' || body?.aspectRatio === 'square' ? body.aspectRatio : 'landscape',
    providers: parseProviders(body?.providers, mediaType),
    perProvider: Number(body?.perProvider) || 8,
    apiKeys: {
      pexels: typeof body?.apiKeys?.pexels === 'string' ? body.apiKeys.pexels : undefined,
      pixabay: typeof body?.apiKeys?.pixabay === 'string' ? body.apiKeys.pixabay : undefined,
    },
  };
}

function reclassifyAsset(asset: MediaAsset): MediaAsset {
  const decision = classifyLicense({
    provider: asset.provider,
    licenseName: asset.license.name,
    licenseUrl: asset.license.url,
    sourceUrl: asset.sourceUrl,
    creator: asset.creator,
    title: asset.title,
    attributionText: asset.attributionText,
    riskFlags: asset.riskFlags,
  });

  return {
    ...asset,
    license: decision.license,
    licenseStatus: decision.licenseStatus,
    riskFlags: decision.riskFlags,
    attributionText: decision.attributionText,
    blockedReasons: decision.blockedReasons,
  };
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json({ limit: '1mb' }));

  app.post('/api/gemini/context', async (req, res) => {
    const { script, targetRegion } = req.body || {};
    if (typeof script !== 'string' || !script.trim()) {
      return res.status(400).json({ error: 'Script is required' });
    }

    try {
      const context = await getGlobalContext(script, targetRegion);
      res.json({ context });
    } catch (error) {
      console.error('Gemini Context Error:', error);
      res.status(getHttpStatus(error)).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/gemini/split', async (req, res) => {
    const { script, context } = req.body || {};
    if (typeof script !== 'string' || !script.trim()) {
      return res.status(400).json({ error: 'Script is required' });
    }
    if (typeof context !== 'string') {
      return res.status(400).json({ error: 'Context is required' });
    }

    try {
      const sentences = await splitScriptIntoSentences(script, context);
      res.json({ sentences });
    } catch (error) {
      console.error('Gemini Split Error:', error);
      res.status(getHttpStatus(error)).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/gemini/analyze', async (req, res) => {
    const { sentence, sentenceId, context, languageMode, targetRegion } = req.body || {};
    if (typeof sentence !== 'string' || !sentence.trim()) {
      return res.status(400).json({ error: 'Sentence is required' });
    }
    if (typeof context !== 'string') {
      return res.status(400).json({ error: 'Context is required' });
    }

    try {
      const analysis = await analyzeSentence(
        sentence,
        Number(sentenceId) || 1,
        context,
        typeof languageMode === 'string' ? languageMode : 'english',
        targetRegion
      );
      res.json({ analysis });
    } catch (error) {
      console.error('Gemini Analyze Error:', error);
      res.status(getHttpStatus(error)).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/media/search', async (req, res) => {
    try {
      const request = normalizeMediaSearchRequest(req.body);
      const items = await searchMediaAssets(request, {
        pexels: process.env.PEXELS_API_KEY,
        pixabay: process.env.PIXABAY_API_KEY,
      });
      res.json({ items });
    } catch (error) {
      console.error('Media Search Error:', error);
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/media/verify-license', async (req, res) => {
    const asset = req.body?.asset as MediaAsset | undefined;
    if (!asset?.id || !asset?.provider) {
      return res.status(400).json({ error: 'Asset is required' });
    }

    try {
      res.json({ asset: reclassifyAsset(asset) });
    } catch (error) {
      console.error('License Verify Error:', error);
      res.status(400).json({ error: getErrorMessage(error) });
    }
  });

  app.post('/api/media/download', async (req, res) => {
    const url = typeof req.body?.url === 'string' ? req.body.url : '';
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: 'Valid media URL is required' });
    }

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 LicenseSafeMediaPipeline/1.0',
        },
      });

      if (!response.ok) {
        return res.status(response.status).json({ error: `Download failed: ${response.statusText}` });
      }

      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      const arrayBuffer = await response.arrayBuffer();
      res.setHeader('Content-Type', contentType);
      res.send(Buffer.from(arrayBuffer));
    } catch (error) {
      console.error('Media Download Error:', error);
      res.status(500).json({ error: getErrorMessage(error) });
    }
  });

  // Google Images Scraper Endpoint
  app.get('/api/image-search', async (req, res) => {
    const { q, num = 5 } = req.query;

    if (!q) {
      return res.status(400).json({ error: 'Query is required' });
    }

    try {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(q as string)}&tbm=isch`;

      const response = await axios.get(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.google.com/',
        },
      });

      const $ = cheerio.load(response.data);
      const images: any[] = [];

      $('img').each((i, el) => {
        const src = $(el).attr('src') || $(el).attr('data-src');
        const alt = $(el).attr('alt') || '';

        if (src && src.startsWith('http') && !src.includes('gstatic.com/favicon') && !src.includes('googlelogo')) {
          images.push({
            id: Date.now() + i,
            url: src,
            alt,
            source: 'Google Images',
          });
        }
      });

      $('script').each((i, el) => {
        const content = $(el).html() || '';
        if (content.includes('AF_initDataCallback') && content.includes('ds:1')) {
          try {
            const urls = content.match(/https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp)/g);
            if (urls) {
              urls.forEach((url, j) => {
                if (!url.includes('gstatic.com') && !url.includes('google.com')) {
                  images.push({
                    id: Date.now() + i + j + 500,
                    url,
                    alt: q as string,
                    source: 'Google Images',
                  });
                }
              });
            }
          } catch {
            // Ignore best-effort scraper parse errors.
          }
        }
      });

      if (images.length < 2) {
        $('a[href^="/imgres"]').each((i, el) => {
          const img = $(el).find('img');
          const src = img.attr('src') || img.attr('data-src');
          if (src && src.startsWith('http')) {
            images.push({
              id: Date.now() + i + 100,
              url: src,
              alt: img.attr('alt') || '',
              source: 'Google Images',
            });
          }
        });
      }

      const uniqueImages = Array.from(new Map(images.map(img => [img.url, img])).values());

      res.json({
        items: uniqueImages.slice(0, Number(num)).map(img => ({
          id: img.id,
          width: 1920,
          height: 1080,
          url: img.url,
          photographer: img.source,
          photographer_url: 'https://images.google.com',
          src: {
            original: img.url,
            large2x: img.url,
            large: img.url,
            medium: img.url,
            small: img.url,
            portrait: img.url,
            landscape: img.url,
            tiny: img.url,
          },
          alt: img.alt,
        })),
      });
    } catch (error: any) {
      console.error('Scraping Error:', error.message);
      res.status(500).json({ error: 'Failed to fetch images' });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
