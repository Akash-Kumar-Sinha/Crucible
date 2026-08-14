import { z } from "zod";
import { ToolRegistry } from "../tools";
import { AgentLoop } from "../agent/loop";
import {
  ENVELOPE_VERSION_V1,
  createToolCallV1,
} from "@crucible/shared-schemas";
import type {
  ModelProvider,
  ModelRequest,
  ModelResponse,
} from "../provider/provider.interface";

async function verifyToolValidationAndEnvelope() {
  console.log(
    "===============================================================",
  );
  console.log("    CRUCIBLE TOOL SCHEMA VALIDATION & ENVELOPE VERIFICATION   ");
  console.log(
    "===============================================================\n",
  );

  // 1. Register a dummy tool with strict parameter constraints
  const dummyToolSchema = z.object({
    orderId: z
      .string()
      .startsWith("ORD-", "Order ID must start with prefix ORD-")
      .describe("Order identifier starting with ORD-"),
    quantity: z
      .number()
      .int()
      .min(1, "Quantity must be at least 1")
      .max(100, "Quantity cannot exceed 100")
      .describe("Item quantity between 1 and 100"),
    priority: z
      .enum(["low", "medium", "high"])
      .describe("Order fulfillment priority level"),
  });

  const registry = new ToolRegistry().register({
    name: "dummy_order_processor",
    description: "Process an order with strict schema validation constraints",
    parameters: dummyToolSchema,
    execute: async ({ orderId, quantity, priority }, ctx) => {
      console.log(
        `[Tool Execution Handler] Processing ${orderId} (Quantity: ${quantity}, Priority: ${priority}) on session ${ctx.sessionId}`,
      );
      return {
        status: "PROCESSED",
        orderId,
        itemsProcessed: quantity,
        fulfillmentTier: priority.toUpperCase(),
        confirmationCode: `CONF-${Date.now().toString(36)}`,
      };
    },
  });

  console.log("[1] Tool registered in registry. Generated JSON Schema:");
  const registered = registry.get("dummy_order_processor");
  console.log(JSON.stringify(registered?.jsonSchema, null, 2));

  // 2. Test Case A: Valid Tool Call Arguments
  console.log(
    "\n---------------------------------------------------------------",
  );
  console.log("[2] Executing Tool Call with VALID arguments...");
  console.log(
    "---------------------------------------------------------------",
  );

  const validCall = createToolCallV1({
    callId: "call_valid_001",
    toolName: "dummy_order_processor",
    input: {
      orderId: "ORD-9842",
      quantity: 5,
      priority: "high",
    },
  });

  const validResultEnvelope = await registry.execute(validCall, {
    sessionId: "sess_test_valid",
    step: 1,
  });

  console.log("\nReceived Valid Result Envelope:");
  console.log(JSON.stringify(validResultEnvelope, null, 2));

  const validShapeCheck =
    validResultEnvelope.version === ENVELOPE_VERSION_V1 &&
    validResultEnvelope.callId === "call_valid_001" &&
    validResultEnvelope.toolName === "dummy_order_processor" &&
    validResultEnvelope.status === "success" &&
    validResultEnvelope.output !== undefined &&
    typeof validResultEnvelope.durationMs === "number" &&
    typeof validResultEnvelope.timestamp === "number";

  console.log(
    `\nValid Result Envelope Check: ${validShapeCheck ? "PASS" : "FAIL"}`,
  );

  // 3. Test Case B: Bad Arguments (Should FAIL validation explicitly)
  console.log(
    "\n---------------------------------------------------------------",
  );
  console.log(
    "[3] Executing Tool Call with INVALID arguments (bad prefix, negative quantity, invalid enum)...",
  );
  console.log(
    "---------------------------------------------------------------",
  );

  const badCall = createToolCallV1({
    callId: "call_invalid_002",
    toolName: "dummy_order_processor",
    input: {
      orderId: "BAD_PREFIX_123", // Does not start with "ORD-"
      quantity: -10, // Less than min 1
      priority: "ultra_high", // Not in enum ["low", "medium", "high"]
    },
  });

  const badResultEnvelope = await registry.execute(badCall, {
    sessionId: "sess_test_bad",
    step: 1,
  });

  console.log("\nReceived Error Result Envelope:");
  console.log(JSON.stringify(badResultEnvelope, null, 2));

  const badShapeCheck =
    badResultEnvelope.version === ENVELOPE_VERSION_V1 &&
    badResultEnvelope.callId === "call_invalid_002" &&
    badResultEnvelope.toolName === "dummy_order_processor" &&
    badResultEnvelope.status === "error" &&
    badResultEnvelope.error?.code === "INVALID_PARAMETERS" &&
    badResultEnvelope.error?.message.includes("Invalid input parameters") &&
    badResultEnvelope.error?.details !== undefined;

  console.log(
    `\nInvalid Parameter Validation Check: ${badShapeCheck ? "PASS" : "FAIL"}`,
  );

  // 4. Test Case C: End-to-End Loop with Model Triggering Dummy Tool
  console.log(
    "\n---------------------------------------------------------------",
  );
  console.log(
    "[4] Feeding Thought-Action-Observation Loop with Dummy Tool Trigger...",
  );
  console.log(
    "---------------------------------------------------------------",
  );

  class MockDummyProvider implements ModelProvider {
    name = "mock_dummy_provider";
    defaultModel = "mock-model";
    private stepCount = 0;

    async complete(request: ModelRequest): Promise<ModelResponse> {
      this.stepCount++;
      if (this.stepCount === 1) {
        return {
          thought:
            "User requested order processing. I will invoke dummy_order_processor.",
          toolCalls: [
            {
              id: "call_loop_003",
              name: "dummy_order_processor",
              arguments: {
                orderId: "ORD-5555",
                quantity: 12,
                priority: "medium",
              },
            },
          ],
          finishReason: "tool_calls",
        };
      } else {
        return {
          thought: "Order processed successfully. Returning confirmation.",
          content:
            "Order ORD-5555 processed successfully with 12 items on MEDIUM priority.",
          finishReason: "stop",
        };
      }
    }
  }

  const loop = new AgentLoop({
    provider: new MockDummyProvider(),
    tools: registry,
    onStep: (step) => {
      console.log(`[Agent Step ${step.step}]`);
      if (step.thought) console.log(` - Thought: ${step.thought}`);
      if (step.actions.length > 0)
        console.log(` - Actions:`, JSON.stringify(step.actions));
      if (step.observations.length > 0)
        console.log(` - Observations:`, JSON.stringify(step.observations));
    },
  });

  const loopResult = await loop.run("Process order ORD-5555 for 12 items");
  console.log(`\nLoop Result State: ${loopResult.state}`);
  console.log(`Final Response: ${loopResult.finalResponse}`);

  const loopPassed =
    loopResult.state === "done" &&
    loopResult.context.stepCount >= 1 &&
    loopResult.finalResponse?.includes("ORD-5555");

  if (validShapeCheck && badShapeCheck && loopPassed) {
    console.log(
      "\n>>> ALL VALIDATION & ENVELOPE SHAPE CHECKS PASSED SUCCESSFULLY! <<<",
    );
  } else {
    console.error("\n>>> VERIFICATION FAILED! <<<");
    process.exit(1);
  }
}

verifyToolValidationAndEnvelope().catch((err) => {
  console.error("Verification script error:", err);
  process.exit(1);
});
