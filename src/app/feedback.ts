import { FeedbackStore } from "../../storage/feedbackStore";
import { SignalType } from "./utils";
import { buildInstructionsWithExamples } from "./utils";

type ConversationMessage = { role: string; text?: string };

export const feedbackStore = new FeedbackStore();

export function buildInstructionsWithFeedbackExamples(
  userId: string,
  baseInstructions: string
): string {
  const examples = feedbackStore.getHighRatedExamples(userId);
  return buildInstructionsWithExamples(baseInstructions, examples);
}

export function handleDetectedSignal(params: {
  signal: SignalType;
  conversationKey: string;
  conversationId: string;
  userId: string;
  userMessage?: string;
  messages: ConversationMessage[];
}): void {
  const { signal, conversationKey, userId, userMessage = "", messages } = params;
  if (signal === "none") {
    return;
  }

  feedbackStore.logEngagement({
    thread_id: conversationKey,
    user_id: userId,
    user_message: userMessage,
    bot_response: "",
    signal,
  });

  if (signal === "thanks") {
    const question = getLatestMessageText(messages, "user");
    const answer = getLatestMessageText(messages, "assistant");

    feedbackStore.saveFeedback({
      thread_id: params.conversationId,
      user_id: userId,
      question,
      answer,
      reaction: "like",
      comment: `Auto-tagged from signal: ${signal}`,
    });

    console.log(
      `[Auto-Feedback] Tagged previous response as helpful due to signal: ${signal}`
    );
  }
}

export function logInitialEngagement(params: {
  conversationKey: string;
  userId: string;
  userMessage?: string;
  botResponse?: string;
}): void {
  const { conversationKey, userId, userMessage = "", botResponse = "" } = params;
  feedbackStore.logEngagement({
    thread_id: conversationKey,
    user_id: userId,
    user_message: userMessage,
    bot_response: botResponse,
    signal: "initial",
  });
}

export function saveFeedbackSubmission(params: {
  threadId: string;
  userId: string;
  reaction: string;
  comment?: string;
  messages: ConversationMessage[];
}): void {
  const { threadId, userId, reaction, comment, messages } = params;
  const question = getLatestMessageText(messages, "user");
  const answer = getLatestMessageText(messages, "assistant");

  feedbackStore.saveFeedback({
    thread_id: threadId,
    user_id: userId,
    question,
    answer,
    reaction,
    comment,
  });
  console.log(`[Feedback] Saved for ${userId}: ${reaction} - ${comment ?? ""}`);
}

function getLatestMessageText(
  messages: ConversationMessage[],
  role: string
): string {
  return (
    [...messages].reverse().find((message) => message.role === role)?.text ?? ""
  );
}
