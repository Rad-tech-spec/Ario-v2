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

// Handle incoming messages
app.on("message", async ({ send, stream, activity }) => {
  //Get conversation history
  const conversationKey = `${activity.conversation.id}/${activity.from.id}`;
  const messages = storage.get(conversationKey) || [];

  try {
    const prompt = new ChatPrompt({
      messages,
      instructions,
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
        "callVendorCatalogAgent",
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
        "callIngredientAgent",
        "Retrieve answers from the ingredient agent hosted in Azure AI Projects.",
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
            console.error("[RecipeTool] Error calling recipe agent:", error);
            return {
              recipeResponse: `Recipe agent error: ${message}`,
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
    }
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
  //add custom feedback process logic here
  console.log("Your feedback is " + JSON.stringify(activity.value));
});

export default app;
