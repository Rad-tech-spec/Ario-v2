import { ChatPrompt, Schema } from "@microsoft/teams.ai";
import { IngredientAgentClient } from "../agents/IngredientAgent";
import { VendorAgentClient } from "../agents/vendorAgent";

export function registerVendorTool(
  prompt: ChatPrompt,
  vendorAgent: VendorAgentClient
): void {
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
        const vendorResponse = await vendorAgent.run(query);
        console.log("[VendorTool] Response from vendor agent:", vendorResponse);
        return { vendorResponse };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Vendor agent call failed.";
        console.error("[VendorTool] Error calling vendor agent:", error);
        return {
          vendorResponse: `Vendor agent error: ${message}`,
        };
      }
    }
  );
}

export function registerIngredientTool(
  prompt: ChatPrompt,
  ingredientAgent: IngredientAgentClient
): void {
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
        return { ingredientResponse };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Recipe agent call failed.";
        console.error("[IngredientTool] Error calling ingredient agent:", error);
        return {
          ingredientResponse: `Ingredient agent error: ${message}`,
        };
      }
    }
  );
}
