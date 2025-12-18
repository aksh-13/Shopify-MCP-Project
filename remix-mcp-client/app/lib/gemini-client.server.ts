/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * GEMINI CLIENT - Google AI Integration with MCP Tool Support
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * This module implements the "agentic loop" pattern for Gemini + MCP tool use:
 *
 *   User Message → Gemini → Tool Request → MCP Server → Tool Result → Gemini → Response
 *
 * The loop continues until Gemini produces a final text response (no more tool requests).
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * DESIGN DECISION: Agentic Loop vs. Single-Shot
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Alternative: Single-shot tool use (Gemini calls one tool, we return immediately)
 * Rejected because:
 * 1. Gemini often needs multiple tools to answer complex queries
 * 2. Chain of thought: Gemini might aggregate data, then request a refund
 * 3. Error recovery: If one tool fails, Gemini can try alternatives
 *
 * The agentic loop pattern allows Gemini to:
 * - Call multiple tools in sequence
 * - Use results from one tool to inform the next
 * - Decide when it has enough information to respond
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 * THREAD SAFETY (Node.js Context)
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Node.js uses a single-threaded event loop. Concurrent requests share:
 * - The MCP client instance (singleton, safe for concurrent use)
 * - The Gemini client instance (stateless, safe for concurrent use)
 *
 * Each request gets its own:
 * - Message array (local to function call)
 * - Tool call tracking (local to function call)
 *
 * No mutexes or locks needed - the event loop serializes I/O naturally.
 */

import { GoogleGenerativeAI, SchemaType, type FunctionDeclaration, type Part, type Content } from '@google/generative-ai';
import { listMcpTools, callMcpTool, type McpTool } from './mcp-client.server';

// ─────────────────────────────────────────────────────────────────────────────
// CLIENT INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY || '');

// ─────────────────────────────────────────────────────────────────────────────
// TYPE DEFINITIONS
// ─────────────────────────────────────────────────────────────────────────────

export interface Message {
  role: 'user' | 'assistant' | 'model';
  content: string;
}

export interface ChatRequest {
  messages: Message[];
  systemPrompt?: string;
  maxToolCalls?: number; // Safety limit
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  result: unknown;
  durationMs: number;
}

export interface ChatResponse {
  message: string;
  toolCalls: ToolCallRecord[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  iterations: number; // How many round-trips in the agentic loop
}

// ─────────────────────────────────────────────────────────────────────────────
// TOOL SCHEMA CONVERSION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert MCP tool schemas to Gemini's FunctionDeclaration format.
 *
 * MCP uses JSON Schema, which Gemini also expects for function parameters.
 * This function adapts the structure to Gemini's expected format.
 *
 * DESIGN DECISION: Conversion at runtime vs. static definition
 * We chose runtime conversion so tools can be dynamically discovered
 * from the MCP server. This means adding a new tool in Rails automatically
 * makes it available to Gemini - no frontend changes needed.
 */
function convertMcpToolsToGeminiFunctions(mcpTools: McpTool[]): FunctionDeclaration[] {
  return mcpTools.map((tool) => ({
    name: tool.name,
    description: tool.description || '',
    parameters: {
      type: SchemaType.OBJECT,
      properties: tool.inputSchema.properties || {},
      required: tool.inputSchema.required || [],
    },
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default system prompt for merchant operations.
 *
 * DESIGN DECISION: Detailed system prompt vs. minimal
 *
 * We chose a detailed prompt because:
 * 1. Gemini benefits from explicit role definition and constraints
 * 2. Tool usage guidance improves first-try accuracy
 * 3. Structured output instructions ensure consistent UX
 *
 * Tradeoff: Longer prompts use more tokens (cost) but significantly
 * improve response quality and tool selection accuracy.
 */
const DEFAULT_SYSTEM_PROMPT = `You are an AI assistant for the Unified Merchant Operations Platform.

## Your Role
You help merchants manage their business by providing insights and taking actions across multiple platforms:
- **Shopify**: E-commerce orders, products, customers
- **Salesforce**: CRM, support cases, sales pipeline
- **Klaviyo**: Email marketing, engagement metrics
- **Cin7**: Inventory management, invoicing (when historical data is requested)

## Available Tools
You have access to MCP tools that fetch real-time data from these platforms. Use them proactively when a merchant asks about customers, orders, or business metrics.

### Tool: aggregate_customer_context
Use this tool when:
- A merchant asks about a specific customer
- You need customer history to make recommendations
- Understanding cross-platform context is needed

The tool returns:
- Raw platform data (for detailed queries)
- A pre-computed summary (quote this in your response)
- Actionable recommendations (surface these proactively)
- Alerts for critical issues (mention these prominently)

### Tool: refund_order
Use this tool when:
- A merchant explicitly requests a refund
- You have confirmed the order ID and amount

This is a WRITE operation. Always confirm details before calling.

## Response Guidelines
1. **Start with the summary**: Quote or paraphrase the tool's summary field.
2. **Surface recommendations**: Proactively mention high-priority recommendations.
3. **Flag alerts**: If there are open support cases or high churn risk, mention them.
4. **Be concise**: Merchants are busy. Get to the point quickly.
5. **Offer next steps**: End with actionable suggestions.

## Example Response Format
When asked about a customer, structure your response as:

"[Customer Name] is a [tenure] customer with $[LTV] lifetime value. [Key insight about recent activity].

**Key Metrics:**
- Orders: [count]
- Last order: [date] ([status])
- Engagement: [score]/10

**Recommendations:**
- [High priority item]
- [Medium priority item]

Would you like me to [suggested action]?"`;

// ─────────────────────────────────────────────────────────────────────────────
// MAIN CHAT FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a message to Gemini with MCP tool support.
 *
 * Implements the agentic loop pattern:
 * 1. Call Gemini with user message + available tools
 * 2. If Gemini requests a tool (function call), execute it via MCP
 * 3. Send tool result back to Gemini
 * 4. Repeat until Gemini produces a text response
 *
 * @param request - Chat request with messages and optional config
 * @returns Chat response with message, tool calls, and usage stats
 */
export async function sendMessageToGemini(request: ChatRequest): Promise<ChatResponse> {
  const {
    messages,
    systemPrompt = DEFAULT_SYSTEM_PROMPT,
    maxToolCalls = 10, // Safety limit to prevent infinite loops
  } = request;

  // ───────────────────────────────────────────────────────────────────
  // INITIALIZE STATE
  // ───────────────────────────────────────────────────────────────────

  // Track all tool calls made during this conversation
  const toolCallRecords: ToolCallRecord[] = [];

  // Track token usage across all API calls in the loop
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Track loop iterations for debugging
  let iterations = 0;

  // ───────────────────────────────────────────────────────────────────
  // FETCH AVAILABLE TOOLS
  // ───────────────────────────────────────────────────────────────────
  //
  // DESIGN DECISION: Fetch tools on every request vs. cache
  //
  // We fetch on every request because:
  // 1. Tools might be added/removed while the server is running
  // 2. Tool availability might depend on user permissions (future)
  // 3. MCP client caches the tool list internally
  //
  // Tradeoff: Slight latency on first request. Acceptable for this use case.
  //
  const mcpTools = await listMcpTools();
  const geminiFunctions = convertMcpToolsToGeminiFunctions(mcpTools);

  console.log(`[Gemini] Starting conversation with ${geminiFunctions.length} tools available`);

  // ───────────────────────────────────────────────────────────────────
  // INITIALIZE GEMINI MODEL WITH TOOLS
  // ───────────────────────────────────────────────────────────────────

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
    systemInstruction: systemPrompt,
    tools: geminiFunctions.length > 0 ? [{ functionDeclarations: geminiFunctions }] : undefined,
  });

  // ───────────────────────────────────────────────────────────────────
  // BUILD CONVERSATION HISTORY
  // ───────────────────────────────────────────────────────────────────
  //
  // Gemini expects messages in a specific format.
  // We convert our Message[] to Gemini's Content[] format.
  //

  const history: Content[] = messages.slice(0, -1).map((msg) => ({
    role: msg.role === 'assistant' || msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.content }],
  }));

  // Get the latest user message
  const latestMessage = messages[messages.length - 1];
  if (!latestMessage || latestMessage.role !== 'user') {
    throw new Error('Last message must be from user');
  }

  // Start chat with history
  const chat = model.startChat({ history });

  // ───────────────────────────────────────────────────────────────────
  // AGENTIC LOOP
  // ───────────────────────────────────────────────────────────────────
  //
  // This is the core pattern for tool-using agents:
  //
  // while (true) {
  //   response = gemini.sendMessage(message)
  //   if (no function calls) break  // Final answer
  //   if (has function calls) {
  //     results = execute_tools(response.functionCalls)
  //     message = [{ functionResponse: ... }]
  //   }
  // }
  //
  // Key insight: We keep sending function responses back to Gemini.
  // Gemini sees the full chain of reasoning and tool results.
  //

  let currentMessage: string | Part[] = latestMessage.content;

  while (iterations < maxToolCalls) {
    iterations++;
    console.log(`[Gemini] Iteration ${iterations}`);

    // ─── CALL GEMINI ───
    const result = await chat.sendMessage(currentMessage);
    const response = result.response;

    // ─── TRACK USAGE ───
    // Note: Gemini's usage metadata structure may vary
    const usageMetadata = response.usageMetadata;
    if (usageMetadata) {
      totalInputTokens += usageMetadata.promptTokenCount || 0;
      totalOutputTokens += usageMetadata.candidatesTokenCount || 0;
    }

    // ─── CHECK FOR FUNCTION CALLS ───
    const candidate = response.candidates?.[0];
    if (!candidate) {
      console.error('[Gemini] No candidate in response');
      return {
        message: 'I apologize, but I was unable to generate a response.',
        toolCalls: toolCallRecords,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
        iterations,
      };
    }

    const parts = candidate.content?.parts || [];
    const functionCalls = parts.filter((part) => 'functionCall' in part);
    const textParts = parts.filter((part) => 'text' in part);

    console.log(
      `[Gemini] Response: ${functionCalls.length} function calls, ` +
        `${textParts.length} text parts, finishReason=${candidate.finishReason}`
    );

    // ─── CHECK FOR FINAL RESPONSE (NO FUNCTION CALLS) ───
    if (functionCalls.length === 0) {
      // Extract text response
      const textContent = textParts
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n\n');

      return {
        message: textContent || 'I have processed your request.',
        toolCalls: toolCallRecords,
        usage: {
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          totalTokens: totalInputTokens + totalOutputTokens,
        },
        iterations,
      };
    }

    // ─── HANDLE FUNCTION CALLS ───
    //
    // Gemini has requested one or more tool calls.
    // We execute them and send results back.
    //

    console.log(`[Gemini] Executing ${functionCalls.length} function(s)`);

    // ─── EXECUTE TOOLS ───
    //
    // DESIGN DECISION: Parallel vs. sequential tool execution
    //
    // We use Promise.all for parallel execution because:
    // 1. Tool calls are independent (no data dependencies)
    // 2. Faster total latency (3x if Gemini requests 3 tools)
    // 3. MCP server handles concurrency internally
    //
    const functionResponses: Part[] = await Promise.all(
      functionCalls.map(async (part) => {
        if (!('functionCall' in part) || !part.functionCall) {
          throw new Error('Expected functionCall in part');
        }

        const functionCall = part.functionCall;
        const functionName = functionCall.name;
        const functionArgs = (functionCall.args as Record<string, unknown>) || {};
        const startTime = Date.now();

        console.log(`[Gemini] Tool: ${functionName}`, functionArgs);

        // Call MCP server
        const mcpResult = await callMcpTool(functionName, functionArgs);

        const durationMs = Date.now() - startTime;

        // Record for response
        toolCallRecords.push({
          name: functionName,
          input: functionArgs,
          result: mcpResult.content[0],
          durationMs,
        });

        console.log(`[Gemini] Tool ${functionName} completed in ${durationMs}ms`);

        // Format for Gemini - function response
        return {
          functionResponse: {
            name: functionName,
            response: mcpResult.content[0],
          },
        } as Part;
      })
    );

    // ─── SEND FUNCTION RESPONSES BACK TO GEMINI ───
    //
    // We send the function responses as the next message.
    // Gemini will process them and either:
    // - Make more function calls
    // - Generate a final text response
    //
    currentMessage = functionResponses;
  }

  // ─── SAFETY LIMIT REACHED ───
  //
  // This is a safety valve. If we hit it, something is wrong:
  // - Gemini might be in a loop
  // - Tools might be returning errors repeatedly
  // - The query might be too complex
  //
  console.error(`[Gemini] Hit max tool calls limit (${maxToolCalls})`);

  return {
    message:
      "I've been working on your request but reached my limit for tool calls. " +
      'Here is what I found so far. Please try a more specific question.',
    toolCalls: toolCallRecords,
    usage: {
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      totalTokens: totalInputTokens + totalOutputTokens,
    },
    iterations,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SIMPLE MESSAGE (NO TOOLS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Send a simple message to Gemini without tool support.
 *
 * Use this for:
 * - General questions not requiring data access
 * - When you want a quick response without MCP overhead
 */
export async function sendSimpleMessage(userMessage: string): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash-exp',
  });

  const result = await model.generateContent(userMessage);
  const response = result.response;

  return response.text() || '';
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Test Gemini API connectivity.
 *
 * Useful for health checks and debugging.
 */
export async function testGeminiConnection(): Promise<{
  connected: boolean;
  model: string;
  error?: string;
}> {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
    });

    const result = await model.generateContent('Say "ok"');
    const response = result.response;

    return {
      connected: true,
      model: 'gemini-2.0-flash-exp',
    };
  } catch (error) {
    return {
      connected: false,
      model: 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
