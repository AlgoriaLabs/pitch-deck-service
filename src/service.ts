// The paid service, defined with provider-kit (Provider Standard v1).
//
// charge "on-success": the buyer's payment settles only after a valid deck exists [S1]. If GitHub or
// every LLM fails, the job fails and nobody is charged. The kit requires expectedDurationSeconds to be
// at most maxTimeoutSeconds / 2 for this mode [S2]; createProvider() uses maxTimeoutSeconds 300.

import { defineService, type Service } from "@stellar-agent-services/provider-kit";
import { makeDeck, type DeckRequest, type DeckResult, type PipelineDeps } from "./pipeline/index.js";

export const SERVICE_NAME = "pitch-deck";

export function pitchDeckService(deps: PipelineDeps, priceUsdc: string): Service {
  return defineService<DeckRequest & Record<string, string>, DeckResult>({
    name: SERVICE_NAME,
    title: "Pitch deck from a GitHub repository",
    // Search matches buyer keywords against descriptions, so it names what buyers type. No prices,
    // URLs or instructions here (spec §3.4).
    description:
      "Creates an investor pitch deck (PowerPoint PPTX, 10 slides) for a software project from its public GitHub repository. " +
      "Reads the README, code layout and dependencies, then writes problem, solution, architecture, features, traction, roadmap and ask slides. " +
      "Returns a download link valid for 24 hours. Public repositories only, up to 40 MB.",
    price: priceUsdc,
    charge: "on-success",
    expectedDurationSeconds: 60,
    timeoutSeconds: 140,
    tags: ["pitch-deck", "pptx", "presentation", "slides", "github", "startup"],
    capacity: { concurrency: 2, maxQueued: 10, maxQueueWaitSeconds: 60 },
    maxInputBytes: 4096,
    inputSchema: {
      type: "object",
      required: ["repoUrl"],
      additionalProperties: false,
      properties: {
        repoUrl: {
          type: "string",
          description: "Public GitHub repository URL",
          pattern: "^https://github\\.com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/?$",
          maxLength: 200,
          examples: ["https://github.com/AlgoriaLabs/stellar-agent-services"],
        },
        ref: {
          type: "string",
          description: "Branch, tag or commit. Default: the default branch.",
          pattern: "^[A-Za-z0-9._/-]{1,100}$",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["deckUrl", "expiresAt", "title", "slideCount", "repo", "commitSha"],
      properties: {
        deckUrl: { type: "string", format: "uri", description: "HTTPS link to the .pptx file" },
        expiresAt: { type: "string", format: "date-time" },
        title: { type: "string" },
        slideCount: { type: "integer", minimum: 1 },
        repo: { type: "string", format: "uri" },
        commitSha: { type: "string", pattern: "^[0-9a-f]{40}$" },
      },
    },
    handler: async (input, { signal }) => makeDeck(input, deps, signal),
  });
}
