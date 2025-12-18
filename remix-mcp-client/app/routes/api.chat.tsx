/**
 * Chat API Route
 *
 * This Remix route handles chat messages from the frontend.
 * It integrates:
 * 1. MCP client (connection to Rails backend)
 * 2. Gemini API (LLM with function calling)
 * 3. React UI (via useFetcher)
 *
 * Flow:
 * 1. Frontend sends POST with user message
 * 2. This action calls Gemini with MCP tools (as function declarations)
 * 3. Gemini may invoke functions (which call Rails via MCP)
 * 4. Final response is returned to frontend
 *
 * This route runs ONLY on the server (no browser code).
 */

import { json, type ActionFunctionArgs } from '@remix-run/node';
import { sendMessageToGemini, type Message } from '~/lib/gemini-client.server';

// Type for request body
interface ChatActionRequest {
  message: string;
  conversationHistory?: Message[];
}

/**
 * POST /api/chat
 *
 * Main chat endpoint called by the React UI.
 *
 * Request body:
 * {
 *   "message": "Show me details for customer@example.com",
 *   "conversationHistory": [
 *     { "role": "user", "content": "Hello" },
 *     { "role": "assistant", "content": "Hi! How can I help?" }
 *   ]
 * }
 *
 * Response:
 * {
 *   "success": true,
 *   "message": "Here's the customer context...",
 *   "toolCalls": [...],
 *   "usage": { ... }
 * }
 */
export async function action({ request }: ActionFunctionArgs) {
  // Only accept POST
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Parse request body
    const body = (await request.json()) as ChatActionRequest;
    const { message, conversationHistory = [] } = body;

    // Validate input
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return json(
        {
          success: false,
          error: 'Message is required',
        },
        { status: 400 }
      );
    }

    console.log(`[Chat API] Received message: ${message.substring(0, 100)}...`);

    // Build conversation with new message
    const messages: Message[] = [
      ...conversationHistory,
      {
        role: 'user' as const,
        content: message,
      },
    ];

    // Call Gemini with MCP tools
    const response = await sendMessageToGemini({ messages });

    console.log(
      `[Chat API] Response generated (${response.usage?.outputTokens} tokens, ${response.toolCalls?.length || 0} tool calls)`
    );

    // Return success response
    return json({
      success: true,
      message: response.message,
      toolCalls: response.toolCalls,
      usage: response.usage,
    });
  } catch (error) {
    console.error('[Chat API] Error:', error);

    // Return error response
    return json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        message: 'Sorry, I encountered an error processing your request. Please try again.',
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/chat (health check)
 *
 * Optional: returns API status and available tools
 */
export async function loader() {
  try {
    // Try to connect to MCP server and list tools
    const { listMcpTools } = await import('~/lib/mcp-client.server');
    const tools = await listMcpTools();

    return json({
      status: 'ok',
      mcp: {
        connected: true,
        toolCount: tools.length,
        tools: tools.map((t) => t.name),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return json(
      {
        status: 'error',
        mcp: {
          connected: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        },
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}