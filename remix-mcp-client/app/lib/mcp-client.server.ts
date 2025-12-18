/**
 * MCP Client - Server-Side Module
 *
 * This module manages the connection to the Rails MCP server via SSE transport.
 * It runs ONLY on the server side (Remix actions/loaders), never in the browser.
 *
 * Architecture:
 * - Single persistent client instance (reused across requests)
 * - Connects to Rails SSE endpoint at startup
 * - Exposes tools to Claude via Anthropic SDK
 * - Handles tool execution by proxying to Rails
 *
 * Thread Safety:
 * - Node.js is single-threaded (event loop)
 * - Multiple concurrent requests share the same MCP client instance
 * - The @modelcontextprotocol/sdk handles concurrent tool calls internally
 *
 * Why Server-Side?
 * - Browser SSE has limitations (no custom headers, CORS complexity)
 * - Keeps MCP_API_KEY secret (never sent to browser)
 * - Allows server-side caching and request deduplication
 * - Better error handling and retry logic
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Global client instance (singleton pattern)
// This is safe in Node.js since the server module is loaded once
let mcpClient: Client | null = null;
let connectionPromise: Promise<Client> | null = null;

// Type definitions for MCP protocol
export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface McpToolResult {
  content: Array<{
    type: string;
    text?: string;
    [key: string]: any;
  }>;
  isError?: boolean;
}

/**
 * Initialize MCP client connection
 *
 * Creates a persistent SSE connection to the Rails MCP server.
 * This should be called once at server startup.
 *
 * Connection Flow:
 * 1. Create EventSource pointing to Rails SSE endpoint
 * 2. Wrap in SSEClientTransport (MCP SDK abstraction)
 * 3. Create MCP Client with transport
 * 4. Call client.initialize() to complete handshake
 * 5. Client is ready to list/call tools
 */
async function initializeMcpClient(): Promise<Client> {
  const serverUrl = process.env.MCP_SERVER_URL || 'http://localhost:3000/mcp/sse';
  const apiKey = process.env.MCP_API_KEY;

  if (!apiKey) {
    throw new Error('MCP_API_KEY environment variable is required');
  }

  console.log(`[MCP Client] Connecting to ${serverUrl}...`);

  try {
    // Create SSE transport with custom headers for authentication
    // The SSEClientTransport handles the EventSource internally
    const transport = new SSEClientTransport(new URL(serverUrl), {
      eventSourceInit: {
        // Custom headers for authentication
        fetch: (url, init) => {
          return fetch(url, {
            ...init,
            headers: {
              ...init?.headers,
              'X-MCP-Api-Key': apiKey,
            },
          });
        },
      },
    });

    // Create MCP client
    const client = new Client(
      {
        name: 'unified-merchant-ops-remix',
        version: '1.0.0',
      },
      {
        capabilities: {
          // We only need tools, not resources or prompts
        },
      }
    );

    // Connect client to transport (this also initializes the session)
    await client.connect(transport);

    console.log('[MCP Client] Connected successfully');

    // Log available tools for debugging
    const { tools } = await client.listTools();
    console.log(`[MCP Client] Available tools: ${tools.map((t) => t.name).join(', ')}`);

    return client;
  } catch (error) {
    console.error('[MCP Client] Connection failed:', error);
    throw new Error(`Failed to connect to MCP server: ${error}`);
  }
}

/**
 * Get or create MCP client instance
 *
 * Singleton pattern ensures only one connection to Rails.
 * Safe for concurrent requests in Node.js event loop.
 */
export async function getMcpClient(): Promise<Client> {
  // If already connected, return existing client
  if (mcpClient) {
    return mcpClient;
  }

  // If connection is in progress, wait for it
  if (connectionPromise) {
    return connectionPromise;
  }

  // Start new connection
  connectionPromise = initializeMcpClient();

  try {
    mcpClient = await connectionPromise;
    return mcpClient;
  } catch (error) {
    // Reset on failure so next call can retry
    connectionPromise = null;
    throw error;
  }
}

/**
 * List all available tools from MCP server
 *
 * This is used to expose tools to Claude via the Anthropic SDK.
 * Claude needs the tool schemas to know what it can call.
 */
export async function listMcpTools(): Promise<McpTool[]> {
  const client = await getMcpClient();
  const { tools } = await client.listTools();
  return tools as McpTool[];
}

/**
 * Call an MCP tool
 *
 * Proxies the tool call to Rails via the MCP protocol.
 * Rails executes the tool and returns the result.
 *
 * @param toolName - Name of the tool to call (e.g., "aggregate_customer_context")
 * @param args - Tool arguments as key-value object
 * @returns Tool result from Rails
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, any>
): Promise<McpToolResult> {
  const client = await getMcpClient();

  console.log(`[MCP Client] Calling tool: ${toolName}`, args);

  try {
    const result = await client.callTool({
      name: toolName,
      arguments: args,
    });

    console.log(`[MCP Client] Tool ${toolName} completed`);

    return result as McpToolResult;
  } catch (error) {
    console.error(`[MCP Client] Tool ${toolName} failed:`, error);

    // Return error in MCP format
    return {
      content: [
        {
          type: 'text',
          text: `Tool execution failed: ${error}`,
        },
      ],
      isError: true,
    };
  }
}

/**
 * Close MCP client connection
 *
 * Call this during graceful shutdown to clean up resources.
 * Not strictly necessary in development but important in production.
 */
export async function closeMcpClient(): Promise<void> {
  if (mcpClient) {
    console.log('[MCP Client] Closing connection...');
    await mcpClient.close();
    mcpClient = null;
    connectionPromise = null;
  }
}

// Graceful shutdown handling
// Ensures SSE connection is closed when server stops
if (process.env.NODE_ENV === 'production') {
  process.on('SIGTERM', async () => {
    await closeMcpClient();
  });

  process.on('SIGINT', async () => {
    await closeMcpClient();
  });
}
