import { App } from "@microsoft/teams.apps";
import { ChatPrompt, Schema } from "@microsoft/teams.ai";
import { LocalStorage } from "@microsoft/teams.common";
import { OpenAIChatModel } from "@microsoft/teams.openai";
import { MessageActivity, TokenCredentials } from "@microsoft/teams.api";
import {
  ManagedIdentityCredential,
  DefaultAzureCredential,
} from "@azure/identity";
import * as fs from "fs";
import * as path from "path";
import config from "../config";
import { VendorAgentClient } from "../agents/vendorAgent";
import { IngredientAgentClient } from "../agents/IngredientAgent"; // adjust path if needed
import { FeedbackStore } from "../../storage/feedbackStore";
const feedbackStore = new FeedbackStore();

// Create storage for conversation history
const storage = new LocalStorage();

// Load instructions from file on initialization
function loadInstructions(): string {
  const instructionsFilePath = path.join(__dirname, "instructions.txt");
  return fs.readFileSync(instructionsFilePath, "utf-8").trim();
}

// Load instructions once at startup
const instructions = loadInstructions();

//Passing vendor crredentials
// Use isAzureHosted to determine if running in Azure with (excludeManagedIdentityCredential)
const isAzureHosted =
  !!process.env.WEBSITE_SITE_NAME ||
  !!process.env.CONTAINER_APP_NAME ||
  !!process.env.FUNCTIONS_WORKER_RUNTIME;

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.CLIENT_ID,
});

// Generate an access token whenever the bot/agent needs to call another Azure service securely using Managed Identity
const createTokenFactory = () => {
  return async (
    scope: string | string[],
    tenantId?: string
  ): Promise<string> => {
    const managedIdentityCredential = new ManagedIdentityCredential({
      clientId: process.env.CLIENT_ID,
    });
    const scopes = Array.isArray(scope) ? scope : [scope];
    const tokenResponse = await managedIdentityCredential.getToken(scopes, {
      tenantId: tenantId,
    });
    return tokenResponse.token;
  };
};

// Configure authentication using TokenCredentials
const tokenCredentials: TokenCredentials = {
  clientId: process.env.CLIENT_ID || "",
  token: createTokenFactory(),
};

const credentialOptions =
  config.MicrosoftAppType === "UserAssignedMsi"
    ? { ...tokenCredentials }
    : undefined;

// Create the app with storage
const app = new App({
  ...credentialOptions,
  storage,
});

// Initialize Vendor and Recipe Agents
let vendorAgent: VendorAgentClient | undefined;
try {
  vendorAgent = new VendorAgentClient(credential);
  console.log("[VendorAgent] Initialized.");
} catch (error) {
  console.warn("[VendorAgent] Initialization skipped:", error);
}

let ingredientAgent: IngredientAgentClient | undefined;
try {
  ingredientAgent = new IngredientAgentClient(credential);
  console.log("[IngredientAgent] Initialized.");
} catch (error) {
  console.warn("[IngredientAgent] Initialization skipped:", error);
}

// Simple signal detection function
function detectSignal(userText: string): "thanks" | "repeat" | "follow-up" | "none" {
  const lower = userText.toLowerCase();
  if (lower.includes("thanks") || lower.includes("thank you")) return "thanks";
  if (lower.includes("again") || lower.includes("same")) return "repeat";
  if (lower.length > 20) return "follow-up"; // crude heuristic
  return "none";
}

// Handle incoming messages
app.on("message", async ({ send, stream, activity }) => {
  //Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  // Integrate high-rated examples into instructions
  const examples = feedbackStore.getHighRatedExamples(activity.from.id);
  const fewShotText = examples.map(e => `Q: ${e.question}\nA: ${e.answer}`).join("\n\n");
  const instructionsWithExamples = `${instructions}\n\n---\nHigh-rated examples:\n${fewShotText}`;

  console.log(instructionsWithExamples);
 
  // Detect user signal for engagement logging and auto-feedback
  const signal = detectSignal(activity.text);
  if (signal !== "none") {
    feedbackStore.logEngagement({
      thread_id: conversationKey,
      user_id: activity.from.id,
      user_message: activity.text,
      bot_response: "", // optional
      signal
    });

    if (signal === "thanks") {
      const messages = storage.get(conversationKey) || [];
      const question = [...messages].reverse().find(m => m.role === "user")?.text ?? "";
      const answer = [...messages].reverse().find(m => m.role === "assistant")?.text ?? "";

      feedbackStore.saveFeedback({
        thread_id: activity.conversation.id,
        user_id: activity.from.id,
        question,
        answer,
        reaction: "like",
        comment: `Auto-tagged from signal: ${signal}`
      });

      console.log(`[Auto-Feedback] Tagged previous response as helpful due to signal: ${signal}`);
    }
  }
 
  try {

    const sanitizedMessages = messages.filter(
      m => typeof m.text === "string" && m.text.trim().length > 0
    ).map(m => ({
      role: m.role,
      content: m.text.trim()
    }));    

    const prompt = new ChatPrompt({
      messages: sanitizedMessages,
      instructions: instructionsWithExamples,
      model: new OpenAIChatModel({
        model: config.azureOpenAIDeploymentName,
        apiKey: config.azureOpenAIKey,
        endpoint: config.azureOpenAIEndpoint,
        apiVersion: "2024-10-21",
      }),
    });

    if (vendorAgent) {
      const vendorToolSchema: Schema = {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Full user request that relates to vendor catalog discovery or vendor information.",
          },
        },
        required: ["query"],
      };

      prompt.function(
        "callVendorAgentClient",
        "Retrieve answers from the vendor catalog agent hosted in Azure AI Projects.",
        vendorToolSchema,
        async ({ query }: { query: string }) => {
          console.log("[VendorTool] Invoked with query:", query);
          try {
            const vendorResponse = await vendorAgent!.run(query);
            console.log(
              "[VendorTool] Response from vendor agent:",
              vendorResponse
            );
            return {
              vendorResponse,
            };
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Vendor agent call failed.";
            console.error("[VendorTool] Error calling vendor agent:", error);
            return {
              vendorResponse: `Vendor agent error: ${message}`,
            };
          }
        }
      );
    }

    if (ingredientAgent) {
      const ingredientToolSchema: Schema = {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Full user request related to recipe or ingredient cost analysis.",
          },
        },
        required: ["query"],
      };

      prompt.function(
        "callIngredientAgentClient",
        "Do not rephrase question when passing to Fabric agent and return raw answer from Fabric agent do not fall back.",
        ingredientToolSchema,
        async ({ query }: { query: string }) => {
          console.log("[IngredientTool] Invoked with query:", query);
          try {
            const ingredientResponse = await ingredientAgent.run(query);
            console.log(
              "[IngredientTool] Response from ingredient agent:",
              ingredientResponse
            );
            return {
              ingredientResponse,
            };
          } catch (error) {
            const message =
              error instanceof Error
                ? error.message
                : "Recipe agent call failed.";
            console.error("[IngredientTool] Error calling ingredient agent:", error);
            return {
              ingredientResponse: `Ingredient agent error: ${message}`,
            };
          }
        }
      );
    }

    const sendOptions = {
      autoFunctionCalling: true as const,
      request: vendorAgent || ingredientAgent
        ? {
            tool_choice: "auto" as const,
          }
        : undefined,
    };

    if (activity.conversation.isGroup) {
      // If the conversation is a group chat, we need to send the final response
      // back to the group chat
      const response = await prompt.send(activity.text, sendOptions);
      console.log(
        "[ChatPrompt][Group] Model response:",
        JSON.stringify(response, null, 2)
      );
      const responseActivity = new MessageActivity(response.content)
        .addAiGenerated()
        .addFeedback();
      await send(responseActivity);

      // Log engagement for 1:1 for improvement analysis
      feedbackStore.logEngagement({
        thread_id: conversationKey,
        user_id: activity.from.id,
        user_message: activity.text,
        bot_response: response.content,
        signal: "initial"
      });

      // Update memory
      if (activity.text?.trim()) {
        messages.push({ role: "user", text: activity.text.trim() });
      }
      if (response.content?.trim()) {
        messages.push({ role: "assistant", text: response.content.trim() });
      }

    } else {
      const response = await prompt.send(activity.text, {
        ...sendOptions,
        onChunk: (chunk) => {
          stream.emit(chunk);
        },
      });
      console.log(
        "[ChatPrompt][1:1] Model response:",
        JSON.stringify(response, null, 2)
      );
      // We wrap the final response with an AI Generated indicator
      stream.emit(new MessageActivity().addAiGenerated().addFeedback());

      // Log engagement for 1:1 for improvement analysis
      feedbackStore.logEngagement({
        thread_id: conversationKey,
        user_id: activity.from.id,
        user_message: activity.text,
        bot_response: response.content,
        signal: "initial"
      });

      // Update memory
      if (activity.text?.trim()) {
        messages.push({ role: "user", text: activity.text.trim() });
      }
      if (response.content?.trim()) {
        messages.push({ role: "assistant", text: response.content.trim() });
      }
    }
    
    // Save updated conversation history
    storage.set(conversationKey, messages);

  } catch (error) {
    console.error(error);
    await send("The agent encountered an error or bug.");
    await send(
      "To continue to run this agent, please fix the agent source code."
    );
  }
});

app.on("message.submit.feedback", async ({ activity }) => {

  const { reaction, feedback: comment } = activity.value.actionValue;
  const threadId = activity.conversation.id;
  const userId = activity.from.id;
  const conversationKey = `${threadId}/${userId}`;

  const messages = storage.get(conversationKey) || [];
  const question = [...messages].reverse().find(m => m.role === "user")?.text ?? "";
  const answer = [...messages].reverse().find(m => m.role === "assistant")?.text ?? "";

  feedbackStore.saveFeedback({ thread_id: threadId, user_id: userId, question, answer, reaction, comment });
  console.log(`[Feedback] Saved for ${userId}: ${reaction} - ${comment}`);

  //add custom feedback process logic here
  //console.log("Your feedback is " + JSON.stringify(activity.value));
});

export default app;
