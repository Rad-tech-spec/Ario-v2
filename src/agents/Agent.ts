export interface TurnContext {
  activity: {
    text: string;
  };
  sendActivity(message: string): Promise<{ id?: string } | undefined>;
}

export abstract class Agent {
  abstract run(context: TurnContext): Promise<string | null>;

  async sendStringMessage(context: TurnContext, message: string): Promise<string | null> {
    const res = await context.sendActivity(message);
    return res?.id ?? null;
  }
}