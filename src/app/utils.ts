import { ManagedIdentityCredential } from "@azure/identity";
import * as fs from "fs";
import * as path from "path";

export type SignalType = "thanks" | "repeat" | "follow-up" | "none";

export function loadInstructionsFromFile(
  baseDir: string,
  fileName = "instructions.txt"
): string {
  const instructionsFilePath = path.join(baseDir, fileName);
  return fs.readFileSync(instructionsFilePath, "utf-8").trim();
}

export function createTokenFactory(clientId?: string) {
  return async (scope: string | string[], tenantId?: string): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
      clientId,
    });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId,
    });
    return tokenResponse.token;
  };
}

export function detectSignal(userText?: string): SignalType {
  if (!userText) {
    return "none";
  }

  const lower = userText.toLowerCase();
  if (lower.includes("thanks") || lower.includes("thank you")) return "thanks";
  if (lower.includes("again") || lower.includes("same")) return "repeat";
  if (lower.length > 20) return "follow-up";
  return "none";
}

export function buildInstructionsWithExamples(
  baseInstructions: string,
  examples: { question: string; answer: string }[]
): string {
  const fewShotText = examples
    .map((example) => `Q: ${example.question}\nA: ${example.answer}`)
    .join("\n\n");
  return `${baseInstructions}\n\n---\nHigh-rated examples:\n${fewShotText}`;
}

export type SanitizedMessage = {
  role: "user" | "system" | "model";
  content: string;
};

export function sanitizeMessages(
  messages: Array<{ role: string; text?: string }>
): SanitizedMessage[] {
  return messages
    .filter(
      (message) => typeof message.text === "string" && message.text.trim().length > 0
    )
    .map((message) => {
      const content = message.text!.trim();
      const role = normalizeRole(message.role);
      return { role, content };
    });
}

function normalizeRole(role: string): SanitizedMessage["role"] {
  switch (role) {
    case "assistant":
    case "model":
      return "model";
    case "system":
      return "system";
    default:
      return "user";
  }
}
