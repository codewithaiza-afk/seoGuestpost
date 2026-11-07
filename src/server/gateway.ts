import { createOpenAI } from "@ai-sdk/openai";
import { NoObjectGeneratedError, Output, streamText, type ModelMessage } from "ai";
import type { z } from "zod";

/**
 * Server-only Lovable AI Gateway helpers.
 * Call sites are createServerFn handlers / server routes only.
 */

const LOVABLE_AIG_RUN_ID_HEADER = "X-Lovable-AIG-Run-ID";
const GATEWAY_BASE_URL = "https://ai.gateway.lovable.dev/v1";
const PITCH_MODEL = "openai/gpt-4o";

function createLovableAiGatewayRunIdFetch(initialRunId?: string) {
  let runId = initialRunId?.trim() || undefined;

  return {
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      if (runId && !headers.has(LOVABLE_AIG_RUN_ID_HEADER)) {
        headers.set(LOVABLE_AIG_RUN_ID_HEADER, runId);
      }
      const response = await fetch(input, { ...init, headers });
      runId ??= response.headers.get(LOVABLE_AIG_RUN_ID_HEADER)?.trim() || undefined;
      return response;
    },
    getRunId: () => runId,
  };
}

export async function generateStructured<T extends z.ZodType>(args: {
  system: string;
  prompt: string;
  schema: T;
}): Promise<z.infer<T>> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) {
    throw new Error("AI is not configured for this project (missing server key).");
  }

  const runIdFetch = createLovableAiGatewayRunIdFetch();
  const provider = createOpenAI({
    baseURL: GATEWAY_BASE_URL,
    apiKey,
    headers: { "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "vercel-ai-sdk" },
    fetch: runIdFetch.fetch,
  });

  const messages: ModelMessage[] = [{ role: "user", content: args.prompt }];

  const result = streamText({
    model: provider.responses(PITCH_MODEL),
    system: args.system,
    messages,
    output: Output.object({ schema: args.schema }),
    providerOptions: {
      openai: {
        store: false,
        forceReasoning: true,
        reasoningEffort: "low",
        reasoningSummary: "auto",
        include: ["reasoning.encrypted_content"],
      },
    },
  });

  try {
    return await result.output;
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error)) {
      console.error("AI structured output failed:", error.text);
      throw new Error("The AI could not generate a valid result. Please try again.");
    }
    throw error;
  }
}
