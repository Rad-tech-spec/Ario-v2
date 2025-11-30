// npm i @azure/ai-agents @azure/identity
import { AgentsClient } from "@azure/ai-agents";
import { TokenCredential } from "@azure/core-auth";

<<<<<<< ours
=======
export type AgentCitation =
  | {
      index: number;
      type: "url_citation";
      text?: string;
      title?: string;
      url?: string;
    }
  | {
      index: number;
      type: "file_citation";
      text?: string;
      quote?: string;
      fileId?: string;
    }
  | {
      index: number;
      type: "file_path";
      text?: string;
      fileId?: string;
    };

export interface IngredientAgentResult {
  text: string;
  citations: AgentCitation[];
}

>>>>>>> theirs
export class IngredientAgentClient {
  private client: AgentsClient;
  private agentId: string;

  constructor(credential: TokenCredential) {
    const endpoint = process.env.AI_PROJECT_ENDPOINT; // e.g. https://<project>.<region>.projects.azure.com
    const agentId = process.env.INGREDIENT_AGENT_ID;

    if (!endpoint) throw new Error("Missing AI_PROJECT_ENDPOINT (use your Project endpoint, NOT the AOAI endpoint).");
    if (!agentId) throw new Error("Missing INGREDIENT_AGENT_ID");

    this.client = new AgentsClient(endpoint, credential);
    this.agentId = agentId;
  }

  // Pattern A: explicit thread + message + run (SDK polls for you)
  async run(query: string): Promise<string> {
    const thread = await this.client.threads.create();
    console.log(`[IngredientAgent] query: ${query}, threadId: ${thread.id}`);
    await this.client.messages.create(thread.id, "user", query + " Take as is do not rephrase and return exact answer from fabric agent and show citations");
    
    // Polling handled by SDK
    await this.client.runs.createAndPoll(thread.id, this.agentId, {
      pollingOptions: { intervalInMs: 1500 },
    });

    // Read most recent assistant message
    const it = this.client.messages.list(thread.id, { order: "desc" });
    for await (const m of it) {
      if (m.role === "assistant") {
        const text = m.content.find((c) => c.type === "text");
        // @ts-expect-error: runtime check is fine
        return text?.text?.value ?? "[No text in assistant message]";
      }
    }
    return "[No assistant message returned]";
  }

  // Pattern B: one-shot create thread + run
  async runOneShot(query: string): Promise<string> {
    const run = await this.client.runs.createThreadAndRun(this.agentId, {
      thread: { messages: [{ role: "user", content: query }] },
    });
    // After it completes, fetch messages from run.threadId
    const it = this.client.messages.list(run.threadId, { order: "desc" });
    for await (const m of it) {
      if (m.role === "assistant") {
        const text = m.content.find((c) => c.type === "text");
        // @ts-expect-error: runtime check is fine
        return text?.text?.value ?? "[No text in assistant message]";
      }
    }
<<<<<<< ours
    return "[No assistant message returned]";
=======
    return { text: "[No assistant message returned]", citations: [] };
  }

  private extractTextBlock(message: any): IngredientAgentResult | undefined {
    const textBlock = (message?.content ?? []).find(
      (c: any) => c?.type === "text"
    );
    if (!textBlock?.text) {
      return undefined;
    }

    const text = typeof textBlock.text.value === "string"
      ? textBlock.text.value
      : "[No text in assistant message]";
    const citations = this.mapAnnotations(textBlock.text.annotations);
    return { text, citations };
  }

  private mapAnnotations(annotations: any): AgentCitation[] {
    if (!Array.isArray(annotations)) {
      return [];
    }

    const mapped = annotations
      .map((annotation, idx) => {
        if (!annotation || typeof annotation !== "object") {
          return undefined;
        }

        const base = {
          index: idx + 1,
          text:
            typeof annotation.text === "string" ? annotation.text.trim() : undefined,
        };

        switch (annotation.type) {
          case "url_citation":
            return {
              ...base,
              type: "url_citation" as const,
              title: annotation.urlCitation?.title,
              url: annotation.urlCitation?.url,
            };
          case "file_citation":
            return {
              ...base,
              type: "file_citation" as const,
              quote: annotation.fileCitation?.quote,
              fileId: annotation.fileCitation?.fileId,
            };
          case "file_path":
            return {
              ...base,
              type: "file_path" as const,
              fileId: annotation.filePath?.fileId,
            };
          default:
            return undefined;
        }
      });

    return mapped.filter(Boolean) as AgentCitation[];
>>>>>>> theirs
  }
}
