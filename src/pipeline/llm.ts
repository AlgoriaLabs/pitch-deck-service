// One chat call through a chain of OpenAI-compatible providers (Gemini, Groq, OpenRouter …), free
// tiers first. A provider that is rate-limited, down or returns an unusable outline hands over to the
// next one; each provider gets one repair retry when its JSON is close but invalid.

import type { LlmProviderConfig } from "../config.js";
import type { Digest } from "./digest.js";
import { mockOutline, OutlineError, parseOutline, SYSTEM_PROMPT, userPrompt, type Outline } from "./outline.js";

export interface OutlineResult {
  outline: Outline;
  provider: string;
  model: string;
}

export class LlmError extends Error {
  override name = "LlmError";
}

type Message = { role: "system" | "user" | "assistant"; content: string };

const CALL_TIMEOUT_MS = 45_000;

export async function generateOutline(providers: LlmProviderConfig[], digest: Digest, signal: AbortSignal, log = console): Promise<OutlineResult> {
  const failures: string[] = [];
  for (const provider of providers) {
    if (signal.aborted) break;
    if (provider.name === "mock") return { outline: mockOutline(digest), provider: "mock", model: "mock" };
    const messages: Message[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt(digest) },
    ];
    for (let attempt = 1; attempt <= 2; attempt++) {
      let raw: string;
      try {
        raw = await chat(provider, messages, signal);
      } catch (error) {
        failures.push(`${provider.name}: ${(error as Error).message}`);
        log.warn(`[llm] ${provider.name} failed: ${(error as Error).message}`);
        break; // transport error: next provider
      }
      try {
        return { outline: parseOutline(raw), provider: provider.name, model: provider.model };
      } catch (error) {
        if (!(error instanceof OutlineError)) throw error;
        failures.push(`${provider.name}#${attempt}: ${error.message}`);
        log.warn(`[llm] ${provider.name} attempt ${attempt}: ${error.message}`);
        messages.push({ role: "assistant", content: raw.slice(0, 20_000) });
        messages.push({ role: "user", content: `That was not valid: ${error.message}. Return only the corrected JSON object.` });
      }
    }
  }
  throw new LlmError(`no LLM produced a usable outline (${failures.join(" | ") || "no providers"})`);
}

async function chat(provider: LlmProviderConfig, messages: Message[], signal: AbortSignal): Promise<string> {
  const timeout = AbortSignal.timeout(CALL_TIMEOUT_MS);
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
      // OpenRouter asks for these; other providers ignore them.
      "HTTP-Referer": "https://github.com/pitch-deck-agent",
      "X-Title": "pitch-deck-agent",
    },
    body: JSON.stringify({
      model: provider.model,
      messages,
      temperature: 0.4,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.any([signal, timeout]),
  });
  const text = await response.text();
  if (!response.ok) throw new LlmError(`HTTP ${response.status} ${text.slice(0, 200).replace(/\s+/g, " ")}`);
  let body: { choices?: { message?: { content?: string | null } }[] };
  try {
    body = JSON.parse(text);
  } catch {
    throw new LlmError("response is not JSON");
  }
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") throw new LlmError("empty completion");
  return content;
}
