# Architecture Deep Dive

## Overview

This document explains the architectural decisions, design patterns, and implementation details of the Unified Merchant Operations Platform.

## Table of Contents

1. [Why MCP?](#why-mcp)
2. [Why SSE Transport?](#why-sse-transport)
3. [Thread Safety Strategy](#thread-safety-strategy)
4. [Tool Execution Flow](#tool-execution-flow)
5. [Error Handling](#error-handling)
6. [Performance Optimization](#performance-optimization)
7. [Security Model](#security-model)

## Why MCP?

### The Problem: Data Fragmentation

Merchants use multiple SaaS platforms:
- **Shopify**: E-commerce orders, products, customers
- **Salesforce**: CRM, support cases, opportunities
- **Klaviyo**: Email marketing, engagement metrics
- **Cin7**: Inventory, invoices, shipments

Each platform has:
- Separate login
- Different API schema
- No cross-platform queries
- Manual data correlation required

### The Solution: MCP as a Unification Layer

Model Context Protocol provides:

1. **Standardized Interface**: Tools and resources exposed via consistent schema
2. **AI-Native**: Designed for LLM consumption (structured data + natural language)
3. **Extensible**: Add new platforms without changing client code
4. **Transport Agnostic**: SSE, WebSocket, or stdio

### MCP vs Alternatives

| Approach | Pros | Cons |
|----------|------|------|
| **Direct API Calls** | Simple, fast | No LLM integration, brittle, lots of client code |
| **GraphQL Gateway** | Flexible queries | Not AI-native, requires schema stitching |
| **Custom RPC** | Full control | Reinventing the wheel, no standards |
| **MCP** | ✅ AI-native<br>✅ Standards-based<br>✅ Tool discovery | Newer protocol, smaller ecosystem |

## Why SSE Transport?

We chose **Server-Sent Events (SSE)** over WebSockets or HTTP polling for the MCP transport layer.

### SSE Advantages

1. **Simplicity**:
   - Built on standard HTTP/HTTPS
   - No protocol upgrade negotiation
   - Works through most proxies and firewalls

2. **Efficiency**:
   - Long-lived connection (no repeated handshakes)
   - Automatic reconnection via EventSource API
   - Lower overhead than polling

3. **Perfect for MCP**:
   - Server-to-client streaming (tool results, LLM tokens)
   - Client-to-server requests (tool calls) sent via HTTP POST or embedded in stream
   - Request-response pattern with optional streaming

4. **Deployment-Friendly**:
   - Easier nginx/load balancer configuration vs WebSocket
   - Standard HTTPS (no special ports)
   - Works with serverless (Vercel, Netlify) with minor adaptations

### SSE vs WebSocket

| Feature | SSE | WebSocket |
|---------|-----|-----------|
| Direction | Uni-directional (server → client) | Bi-directional |
| Protocol | HTTP | Custom (ws://) |
| Reconnection | Automatic (built-in) | Manual implementation |
| Proxy Support | Excellent | Sometimes blocked |
| Overhead | Low | Low |
| **Best For** | **Streaming responses, notifications** | Real-time gaming, chat |

For MCP, we need server → client streaming (tool results) more than client → server (which can be HTTP POST). SSE is the sweet spot.

### Implementation Details

**Rails Controller (app/controllers/mcp/streams_controller.rb):**

```ruby
include ActionController::Live  # Enables streaming responses

def stream
  response.headers['Content-Type'] = 'text/event-stream'
  response.headers['Cache-Control'] = 'no-cache'
  response.headers['X-Accel-Buffering'] = 'no'  # Disable nginx buffering

  # Write SSE events
  response.stream.write("data: #{json}\n\n")
end
```

**Node.js Client (app/lib/mcp-client.server.ts):**

```typescript
import EventSource from 'eventsource';

const eventSource = new EventSource(serverUrl, {
  headers: { 'X-MCP-Api-Key': apiKey }
});

const transport = new SSEClientTransport(eventSource);
await client.connect(transport);
```

## Thread Safety Strategy

### Rails (Puma Multi-Threaded Mode)

**Challenge**:
- ActionController::Live spawns a thread per SSE connection
- Multiple threads may access shared resources concurrently
- Risk of race conditions, deadlocks, and data corruption

**Solution**:

1. **Stateless Tools**:
   ```ruby
   class AggregateCustomerContext
     # No instance variables that persist across calls
     # Fresh instance per invocation
     def call(email:)
       # All state is local to this method
     end
   end
   ```

2. **Connection Pooling**:
   ```ruby
   # config/database.yml
   pool: <%= ENV.fetch("RAILS_MAX_THREADS", 5) %>

   # ActiveRecord handles thread-safe connection checkout
   ```

3. **Thread-Local Storage** (when needed):
   ```ruby
   Thread.current[:request_id] = SecureRandom.uuid
   ```

4. **Immutable Defaults**:
   ```ruby
   DEFAULT_CONFIG = {
     timeout: 30,
     retry: 3
   }.freeze  # Frozen hash is thread-safe
   ```

**Puma Configuration**:

```ruby
# config/puma.rb
threads 2, 5  # Min 2, max 5 threads per worker
workers 2     # 2 worker processes (in production)

# Each worker has its own memory space
# Each thread shares worker memory but has its own stack
```

**Testing Thread Safety**:

```ruby
# spec/concurrency_spec.rb
it "handles concurrent tool calls" do
  threads = 10.times.map do
    Thread.new { Tools::AggregateCustomerContext.new.call(email: "test@example.com") }
  end

  results = threads.map(&:value)
  expect(results).to all(be_success)
end
```

### Node.js (Event Loop)

**Challenge**:
- JavaScript is single-threaded (event loop)
- But async I/O can cause race conditions
- Multiple concurrent requests share the same MCP client instance

**Solution**:

1. **Singleton Pattern** (safe in Node.js):
   ```typescript
   let mcpClient: Client | null = null;

   export async function getMcpClient(): Promise<Client> {
     if (!mcpClient) {
       mcpClient = await initializeMcpClient();
     }
     return mcpClient;  // Reused across requests
   }
   ```

2. **Promise-Based Concurrency**:
   ```typescript
   // Multiple requests can call this concurrently
   // Node.js event loop handles serialization
   const result = await callMcpTool(toolName, args);
   ```

3. **No Shared Mutable State**:
   ```typescript
   // Bad (mutable global state)
   let requestCount = 0;
   requestCount++;

   // Good (local state)
   function handleRequest() {
     const requestId = nanoid();
     // ...
   }
   ```

## Tool Execution Flow

### Detailed Sequence Diagram

```
User                Remix UI          Remix Server      MCP Client        Rails SSE         Tool Class        External API
 │                     │                   │                 │                 │                 │                 │
 │  1. Type message    │                   │                 │                 │                 │                 │
 │────────────────────>│                   │                 │                 │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │  2. POST /api/chat│                 │                 │                 │                 │
 │                     │──────────────────>│                 │                 │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  3. sendMessageToClaude()         │                 │                 │
 │                     │                   │─────────────────>                 │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  4. Call Claude API (with tools)  │                 │                 │
 │                     │                   │─────────────────────────────────> │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  5. Claude responds: "use aggregate_customer_context"                 │
 │                     │                   │<───────────────────────────────── │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  6. callMcpTool("aggregate_customer_context", {email: "..."})        │
 │                     │                   │──────────────────────────────────>│                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │  7. Execute tool via SSE          │                 │
 │                     │                   │                 │─────────────────>                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │                 │  8. Instantiate & call()           │
 │                     │                   │                 │                 │─────────────────>                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │                 │                 │  9. Fetch Shopify
 │                     │                   │                 │                 │                 │─────────────────>│
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │                 │                 │  10. Return data │
 │                     │                   │                 │                 │                 │<─────────────────│
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │                 │  11. Return tool result           │
 │                     │                   │                 │                 │<─────────────────                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │                 │  12. Stream result                │                 │
 │                     │                   │                 │<─────────────────                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  13. Return tool result to handler                  │                 │
 │                     │                   │<──────────────────────────────────                  │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  14. Call Claude again (with tool result)           │                 │
 │                     │                   │─────────────────────────────────> │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │                   │  15. Claude final response        │                 │                 │
 │                     │                   │<───────────────────────────────── │                 │                 │
 │                     │                   │                 │                 │                 │                 │
 │                     │  16. JSON response│                 │                 │                 │                 │
 │                     │<──────────────────│                 │                 │                 │                 │
 │                     │                 │                 │                 │                 │                 │
 │  17. Display answer │                 │                 │                 │                 │                 │
 │<────────────────────│                 │                 │                 │                 │                 │
```

### Breakdown by Component

**1. User Input (Remix UI)**
- User types message in `MerchantChat` component
- `useFetcher` sends POST to `/api/chat`

**2. Chat API Endpoint (Remix Server)**
- Receives message + conversation history
- Calls `sendMessageToClaude()` from `claude-client.server.ts`

**3. Claude Client**
- Fetches available MCP tools via `listMcpTools()`
- Converts to Anthropic tool format
- Calls Claude API with tools + message

**4. Claude Decision**
- Analyzes message: "Show me context for jane.doe@example.com"
- Decides to use `aggregate_customer_context` tool
- Returns `tool_use` block with parameters

**5. Tool Execution**
- `callMcpTool()` invoked with tool name + args
- MCP client sends request over SSE to Rails

**6. Rails SSE Handler**
- Receives tool call via SSE stream
- `FastMcp::SseHandler` routes to registered tool
- Instantiates `Tools::AggregateCustomerContext`
- Calls `#call(email: "jane.doe@example.com")`

**7. Tool Execution (Rails)**
- Fetches data from Shopify, Salesforce, Klaviyo, Cin7
- Aggregates into unified structure
- Returns JSON result

**8. Result Streaming**
- Rails streams result back over SSE
- MCP client receives and parses
- Returns to Claude client

**9. Claude Analysis**
- Receives tool result (customer data)
- Generates human-friendly summary
- Returns final text response

**10. UI Update**
- Remix receives Claude's response
- Updates message state
- React renders new assistant message

## Error Handling

### Error Categories

1. **Network Errors**:
   - SSE connection drops
   - API request timeout
   - DNS resolution failure

2. **API Errors**:
   - Shopify rate limit (429)
   - Salesforce authentication expired (401)
   - Claude API quota exceeded

3. **Application Errors**:
   - Tool execution failure
   - Invalid parameters
   - Unexpected data format

### Handling Strategy

**Rails (Resilience)**:

```ruby
def fetch_shopify_data(email)
  retries ||= 0

  client.get("/customers", email: email)

rescue ShopifyAPI::RateLimitError => e
  if retries < 3
    sleep 2 ** retries  # Exponential backoff
    retries += 1
    retry
  else
    Rails.logger.error "Shopify rate limit exceeded: #{e.message}"
    { error: "Shopify unavailable", details: e.message }
  end

rescue Timeout::Error => e
  Rails.logger.error "Shopify timeout: #{e.message}"
  { error: "Shopify timeout" }
end
```

**Remix (Graceful Degradation)**:

```typescript
export async function sendMessageToClaude(request: ChatRequest): Promise<ChatResponse> {
  try {
    const response = await anthropic.messages.create({...});
    return { message: response.content, success: true };

  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      if (error.status === 429) {
        return {
          message: "Claude is busy right now. Please try again in a moment.",
          success: false
        };
      }
    }

    // Generic error
    return {
      message: "Sorry, I encountered an error. Please try again.",
      success: false,
      error: error.message
    };
  }
}
```

**UI (User Feedback)**:

```tsx
{fetcher.data?.error && (
  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
    <p className="text-red-800">{fetcher.data.error}</p>
  </div>
)}
```

## Performance Optimization

### Current Implementation

1. **Parallel Tool Calls** (if Claude requests multiple):
   ```typescript
   const toolResults = await Promise.all(
     toolUseBlocks.map(async (toolUse) => {
       return await callMcpTool(toolUse.name, toolUse.input);
     })
   );
   ```

2. **Singleton MCP Client** (connection reuse):
   ```typescript
   let mcpClient: Client | null = null;  // Reused across requests
   ```

3. **Database Connection Pooling**:
   ```ruby
   # config/database.yml
   pool: 5  # Reuse DB connections
   ```

### Future Optimizations

1. **Caching Layer** (Redis):
   ```ruby
   def fetch_shopify_data(email)
     Rails.cache.fetch("shopify:#{email}", expires_in: 5.minutes) do
       # Expensive API call
       ShopifyAPI::Customer.find(email: email)
     end
   end
   ```

2. **Background Jobs** (Sidekiq) for slow operations:
   ```ruby
   class AggregateCustomerJob < ApplicationJob
     def perform(email)
       # Heavy lifting
     end
   end
   ```

3. **Streaming Responses** (stream Claude tokens as they arrive):
   ```typescript
   // Anthropic supports streaming
   const stream = await anthropic.messages.create({
     stream: true,
     ...
   });

   for await (const event of stream) {
     // Send each token to UI immediately
   }
   ```

## Security Model

### Authentication Flow

```
Client                    Rails MCP Server
  │                             │
  │  1. GET /mcp/sse            │
  │  Header: X-MCP-Api-Key: abc │
  │────────────────────────────>│
  │                             │
  │                             │  2. Validate API key
  │                             │     against ENV['MCP_API_KEY']
  │                             │
  │  3. 200 OK (SSE stream)     │
  │<────────────────────────────│
  │                             │
  │  OR                         │
  │                             │
  │  3. 401 Unauthorized        │
  │<────────────────────────────│
```

### Current Security Measures

1. **API Key Authentication**:
   ```ruby
   def authenticate_mcp_client!
     api_key = request.headers['X-MCP-Api-Key']
     expected = ENV['MCP_API_KEY']

     unless api_key.present? && api_key == expected
       render json: { error: "Unauthorized" }, status: :unauthorized
     end
   end
   ```

2. **CORS Restrictions**:
   ```ruby
   allow do
     origins Rails.env.production? ? 'https://merchant-ops.com' : '*'
     resource '/mcp/*', methods: [:get, :post]
   end
   ```

3. **Input Validation**:
   ```ruby
   parameter :email,
             type: :string,
             required: true,
             pattern: /\A[\w+\-.]+@[a-z\d\-]+(\.[a-z\d\-]+)*\.[a-z]+\z/i
   ```

### Production Security Enhancements

1. **JWT-Based Auth**:
   ```ruby
   def authenticate_mcp_client!
     token = request.headers['Authorization']&.split(' ')&.last
     payload = JWT.decode(token, Rails.application.credentials.secret_key_base)
     @current_merchant = Merchant.find(payload['merchant_id'])
   rescue JWT::DecodeError
     render json: { error: "Invalid token" }, status: :unauthorized
   end
   ```

2. **Rate Limiting**:
   ```ruby
   # Gemfile
   gem 'rack-attack'

   # config/initializers/rack_attack.rb
   Rack::Attack.throttle('mcp/ip', limit: 100, period: 1.minute) do |req|
     req.ip if req.path.start_with?('/mcp')
   end
   ```

3. **Audit Logging**:
   ```ruby
   class AuditLog < ApplicationRecord
     # merchant_id, tool_name, parameters, result, created_at
   end

   def handle_tool_call(tool_name, parameters)
     result = FastMcp.execute_tool(tool_name, parameters)

     AuditLog.create!(
       merchant_id: @current_merchant.id,
       tool_name: tool_name,
       parameters: parameters,
       result: result
     )

     result
   end
   ```

4. **Data Encryption**:
   ```ruby
   # config/credentials.yml.enc
   shopify:
     api_key: <%= ENV['SHOPIFY_API_KEY'] %>
     secret: <%= ENV['SHOPIFY_SECRET'] %>

   # Use ActiveRecord encryption for sensitive data
   class Merchant < ApplicationRecord
     encrypts :shopify_access_token
   end
   ```

---

This architecture balances simplicity (for the MVP) with production-readiness (clear path to scale). All major architectural decisions are documented with rationale.
