async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = typeof payload?.error === 'string'
      ? payload.error
      : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function getGlobalContext(script: string, targetRegion?: string): Promise<string> {
  const payload = await postJson<{ context: string }>('/api/gemini/context', {
    script,
    targetRegion,
  });

  return payload.context || 'Cinematic storytelling.';
}

export async function splitScriptIntoSentences(script: string, context: string): Promise<string[]> {
  const payload = await postJson<{ sentences: string[] }>('/api/gemini/split', {
    script,
    context,
  });

  return Array.isArray(payload.sentences) ? payload.sentences : [];
}

export async function analyzeSentence(
  sentence: string,
  sentenceId: number,
  context: string,
  languageMode: string,
  targetRegion?: string
): Promise<any> {
  const payload = await postJson<{ analysis: any }>('/api/gemini/analyze', {
    sentence,
    sentenceId,
    context,
    languageMode,
    targetRegion,
  });

  return payload.analysis;
}
