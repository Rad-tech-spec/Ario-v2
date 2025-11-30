import { App } from "@microsoft/teams.apps";
import { ChatPrompt } from "@microsoft/teams.ai";
import { LocalStorage } from "@microsoft/teams.common";
import { OpenAIChatModel } from "@microsoft/teams.openai";
import { MessageActivity, TokenCredentials } from "@microsoft/teams.api";
import { DefaultAzureCredential } from "@azure/identity";
import config from "../config";
import { VendorAgentClient } from "../agents/vendorAgent";
import { IngredientAgentClient } from "../agents/IngredientAgent"; // adjust path if needed
import {
  createTokenFactory,
  detectSignal,
  loadInstructionsFromFile,
  sanitizeMessages,
} from "./utils";
import {
  registerIngredientTool,
  registerVendorTool,
} from "./tools";
import {
  buildInstructionsWithFeedbackExamples,
  handleDetectedSignal,
  logInitialEngagement,
  saveFeedbackSubmission,
} from "./feedback";

// Create storage for conversation history
const storage = new LocalStorage();

// Load instructions once at startup
const instructions = loadInstructionsFromFile(__dirname);

//Passing vendor crredentials
// Use isAzureHosted to determine if running in Azure with (excludeManagedIdentityCredential)
const isAzureHosted =
  !!process.env.WEBSITE_SITE_NAME ||
  !!process.env.CONTAINER_APP_NAME ||
  !!process.env.FUNCTIONS_WORKER_RUNTIME;

const credential = new DefaultAzureCredential({
  managedIdentityClientId: process.env.CLIENT_ID,
});

// Configure authentication using TokenCredentials
const tokenCredentials: TokenCredentials = {
  clientId: process.env.CLIENT_ID || "",
  token: createTokenFactory(process.env.CLIENT_ID),
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

  // Integrate high-rated examples into instructions
  const instructionsWithExamples = buildInstructionsWithFeedbackExamples(
    activity.from.id,
    instructions
  );

  console.log(instructionsWithExamples);
 
  // Detect user signal for engagement logging and auto-feedback
  const signal = detectSignal(activity.text);
  handleDetectedSignal({
    signal,
    conversationKey,
    conversationId: activity.conversation.id,
    userId: activity.from.id,
    userMessage: activity.text,
    messages,
  });
 
  try {
    const sanitizedMessages = sanitizeMessages(messages);

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
      registerVendorTool(prompt, vendorAgent);
    }

    if (ingredientAgent) {
      registerIngredientTool(prompt, ingredientAgent);
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
      logInitialEngagement({
        conversationKey,
        userId: activity.from.id,
        userMessage: activity.text,
        botResponse: response.content,
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
      logInitialEngagement({
        conversationKey,
        userId: activity.from.id,
        userMessage: activity.text,
        botResponse: response.content,
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

  saveFeedbackSubmission({
    threadId,
    userId,
    reaction,
    comment,
    messages,
  });

  //add custom feedback process logic here
  //console.log("Your feedback is " + JSON.stringify(activity.value));
});

export default app;
