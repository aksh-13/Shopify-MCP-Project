# Unified Merchant Operations Platform

An AI-powered platform that aggregates merchant data from **Shopify**, **Salesforce**, **Klaviyo**, and **Cin7** into a single conversational interface using the **Model Context Protocol (MCP)**.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Remix Frontend                           │
│  ┌──────────────────┐         ┌─────────────────────────────┐  │
│  │  MerchantChat    │────────▶│   /api/chat Endpoint        │  │
│  │  React Component │         │   (Remix Action)            │  │
│  └──────────────────┘         └─────────────────────────────┘  │
│                                        │                        │
│                                        ▼                        │
│                          ┌─────────────────────────┐           │
│                          │  Claude API Client      │           │
│                          │  (Anthropic SDK)        │           │
│                          └─────────────────────────┘           │
│                                        │                        │
│                                        ▼                        │
│                          ┌─────────────────────────┐           │
│                          │  MCP Client (Server)    │           │
│                          │  SSE Transport          │           │
│                          └─────────────────────────┘           │
└───────────────────────────────┼────────────────────────────────┘
                                │ SSE over HTTP
                                │ (X-MCP-Api-Key auth)
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Rails MCP Server                           │
│  ┌──────────────────┐         ┌─────────────────────────────┐  │
│  │  SSE Controller  │────────▶│   FastMcp Handler           │  │
│  │  (/mcp/sse)      │         │   (Tool Execution)          │  │
│  └──────────────────┘         └─────────────────────────────┘  │
│                                        │                        │
│                                        ▼                        │
│                          ┌─────────────────────────┐           │
│                          │  MCP Tools:             │           │
│                          │  - AggregateCustomer    │           │
│                          │  - RefundOrder          │           │
│                          └─────────────────────────┘           │
│                                        │                        │
│                    ┌───────────────────┼──────────────────┐    │
│                    ▼                   ▼                  ▼    │
│            ┌──────────┐        ┌──────────┐       ┌──────────┐│
│            │ Shopify  │        │Salesforce│       │ Klaviyo  ││
│            │   API    │        │   API    │       │   API    ││
│            └──────────┘        └──────────┘       └──────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

- **Unified Data Access**: Query customer data across multiple platforms in one request
- **AI-Powered Insights**: Claude analyzes aggregated data and provides actionable recommendations
- **MCP Protocol**: Standards-based tool calling via Model Context Protocol
- **Real-time Streaming**: SSE transport for low-latency responses
- **Thread-Safe**: Built for concurrent requests in production environments
- **Extensible**: Easy to add new tools and data sources

## Technology Stack

### Backend (Rails MCP Server)
- **Ruby**: 3.3
- **Rails**: 7.2
- **MCP**: fast-mcp gem (≥ 1.5.0)
- **Transport**: Server-Sent Events (SSE)
- **Server**: Puma (threaded mode)

### Frontend (Remix MCP Client)
- **Framework**: Remix (React + TypeScript)
- **Styling**: Tailwind CSS
- **MCP Client**: @modelcontextprotocol/sdk
- **LLM**: Claude Sonnet 4.5 (Anthropic)

## Project Structure

```
Shopify MCP Project/
├── rails-mcp-server/           # Rails backend (MCP server)
│   ├── app/
│   │   ├── controllers/
│   │   │   └── mcp/
│   │   │       ├── streams_controller.rb   # SSE endpoint
│   │   │       └── tools_controller.rb     # Dev testing
│   │   └── tools/
│   │       ├── aggregate_customer_context.rb
│   │       └── refund_order.rb
│   ├── config/
│   │   ├── initializers/
│   │   │   ├── fast_mcp.rb                 # MCP configuration
│   │   │   └── cors.rb                     # CORS setup
│   │   ├── puma.rb                         # Server config
│   │   └── routes.rb
│   └── Gemfile
│
└── remix-mcp-client/           # Remix frontend (MCP client)
    ├── app/
    │   ├── components/
    │   │   └── MerchantChat.tsx            # Main UI component
    │   ├── lib/
    │   │   ├── mcp-client.server.ts        # MCP client (SSE)
    │   │   └── claude-client.server.ts     # Claude integration
    │   ├── routes/
    │   │   ├── _index.tsx                  # Home page
    │   │   └── api.chat.tsx                # Chat API endpoint
    │   └── root.tsx
    └── package.json
```

## Getting Started

### Prerequisites

- Ruby 3.3.0
- Node.js 20+
- PostgreSQL
- Anthropic API key ([get one here](https://console.anthropic.com/))

### 1. Rails MCP Server Setup

```bash
cd rails-mcp-server

# Install dependencies
bundle install

# Set up environment variables
cp .env.example .env
# Edit .env and set:
# - MCP_API_KEY=your-secure-key-here
# - DATABASE_URL=postgresql://localhost/merchant_ops_dev

# Set up database
rails db:create db:migrate

# Start server (port 3000)
rails server
```

**Verify Rails is running:**
```bash
curl http://localhost:3000/up
# Should return: {"status":"ok"}
```

### 2. Remix MCP Client Setup

```bash
cd remix-mcp-client

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env and set:
# - MCP_SERVER_URL=http://localhost:3000/mcp/sse
# - MCP_API_KEY=<same key as Rails>
# - ANTHROPIC_API_KEY=sk-ant-api03-...

# Start dev server (port 3001)
npm run dev
```

**Verify Remix is running:**
```bash
# Check MCP connection status
curl http://localhost:3001/api/chat
```

### 3. Access the Application

Open your browser to:
```
http://localhost:3001
```

You should see the Unified Merchant Operations Platform chat interface!

## Usage Examples

### Example 1: Aggregate Customer Context

In the chat interface, try:

```
Show me the context for jane.doe@example.com
```

**What happens:**
1. User message sent to Remix `/api/chat` endpoint
2. Remix calls Claude with available MCP tools
3. Claude decides to use `aggregate_customer_context` tool
4. Remix MCP client calls Rails via SSE
5. Rails executes the tool (fetches from Shopify, Salesforce, Klaviyo, Cin7)
6. Data returned to Claude
7. Claude analyzes and generates human-friendly response
8. Response displayed in chat UI

**Expected Response:**
```
Jane Doe has been a customer since 2022-12-11 with a lifetime value of $2,450.50
across 12 orders. Last order was 15 days ago.

CRM status: Active Customer (Gold tier). 1 open support case(s).

Email engagement is strong (score: 8.5/10). Predicted next purchase in 12 days.

Recommendations:
- High-value customer ($2,450.50 LTV). Consider personal outreach or VIP program
  invite.
- Highly engaged email subscriber. Good candidate for new product launches or
  exclusive offers.
- Active support case. Ensure resolution before next marketing campaign.
```

### Example 2: Test Tools Directly (Development)

You can test MCP tools directly via HTTP (only available in development):

```bash
# List available tools
curl http://localhost:3000/mcp/tools \
  -H "X-MCP-Api-Key: your-key-here"

# Execute aggregate_customer_context tool
curl -X POST http://localhost:3000/mcp/tools/aggregate_customer_context \
  -H "X-MCP-Api-Key: your-key-here" \
  -H "Content-Type: application/json" \
  -d '{"email": "customer@example.com", "include_historical": true}'
```

## Configuration

### Rails MCP Server

**Environment Variables (.env):**

```bash
# Required
MCP_API_KEY=your-secure-api-key-here

# Optional (for production integrations)
SHOPIFY_API_KEY=
SHOPIFY_SHOP_DOMAIN=
SHOPIFY_ACCESS_TOKEN=

SALESFORCE_CLIENT_ID=
SALESFORCE_CLIENT_SECRET=
SALESFORCE_INSTANCE_URL=

KLAVIYO_API_KEY=

CIN7_API_KEY=
CIN7_ACCOUNT_ID=
```

**Adding New Tools:**

1. Create tool class in `app/tools/`:
```ruby
# app/tools/my_new_tool.rb
module Tools
  class MyNewTool
    include FastMcp::Annotations

    parameter :param_name, type: :string, required: true

    def call(param_name:)
      # Tool logic here
      { result: "success" }
    end
  end
end
```

2. Register in `config/initializers/fast_mcp.rb`:
```ruby
FastMcp.register_tool(
  name: "my_new_tool",
  description: "What this tool does",
  tool_class: "Tools::MyNewTool"
)
```

### Remix MCP Client

**Environment Variables (.env):**

```bash
# Required
MCP_SERVER_URL=http://localhost:3000/mcp/sse
MCP_API_KEY=your-secure-api-key-here
ANTHROPIC_API_KEY=sk-ant-api03-...

# Optional
NODE_ENV=development
PORT=3001
```

## Security Considerations

### Current Implementation (Development)

- Simple API key authentication via `X-MCP-Api-Key` header
- CORS allows all origins in development

### Production Recommendations

1. **Authentication**:
   - Use JWT tokens with expiration
   - Implement OAuth 2.0 client credentials flow
   - Store per-merchant API keys in database
   - Add IP allowlisting

2. **Transport**:
   - Enforce HTTPS only
   - Use secure WebSocket (wss://) instead of SSE for browser clients
   - Implement rate limiting (e.g., rack-attack)

3. **Data**:
   - Encrypt sensitive data at rest
   - Mask PII in logs
   - Implement audit logging for all tool executions
   - Add data retention policies

4. **Infrastructure**:
   - Use environment-specific API keys
   - Enable Rails credentials encryption
   - Configure nginx/load balancer for SSE (disable buffering)
   - Monitor open SSE connections (prevent resource exhaustion)

## Thread Safety

### Rails (Puma)

- Puma runs in threaded mode (default: 5 threads per worker)
- `ActionController::Live` spawns a new thread per SSE connection
- All MCP tools are stateless (no shared mutable state)
- Connection pooling for database and external APIs

**Concurrency Configuration (config/puma.rb):**
```ruby
max_threads_count = ENV.fetch("RAILS_MAX_THREADS", 5)
workers ENV.fetch("WEB_CONCURRENCY", 2)
```

### Node.js (Remix)

- Single-threaded event loop
- Singleton MCP client instance (reused across requests)
- `@modelcontextprotocol/sdk` handles concurrent tool calls internally
- Non-blocking I/O for SSE and API calls

## Troubleshooting

### Rails SSE Connection Issues

**Problem**: Client can't connect to `/mcp/sse`

**Solutions**:
```bash
# 1. Check Rails is running
curl http://localhost:3000/up

# 2. Verify API key
curl -H "X-MCP-Api-Key: your-key" http://localhost:3000/mcp/sse

# 3. Check logs
tail -f log/development.log

# 4. Disable Spring (conflicts with ActionController::Live)
spring stop
```

### Remix MCP Client Errors

**Problem**: `Cannot find module '@modelcontextprotocol/sdk'`

**Solution**:
```bash
npm install @modelcontextprotocol/sdk eventsource
```

**Problem**: MCP client disconnects frequently

**Solution**:
- Check Rails server hasn't crashed
- Verify SSE timeout settings in `streams_controller.rb`
- Check nginx/proxy isn't buffering SSE (add `X-Accel-Buffering: no`)

### Claude API Errors

**Problem**: `Invalid API key`

**Solution**:
- Verify `ANTHROPIC_API_KEY` in `.env`
- Check key format: `sk-ant-api03-...`
- Verify account has credits at https://console.anthropic.com/

**Problem**: `Tool use not working`

**Solution**:
- Ensure MCP tools are registered (check `/api/chat` loader)
- Verify tool schema matches Anthropic format
- Check Rails tool execution logs

## Development

### Running Tests

**Rails:**
```bash
cd rails-mcp-server
bundle exec rspec
```

**Remix:**
```bash
cd remix-mcp-client
npm test
```

### Code Quality

**Rails:**
```bash
# Linting
bundle exec rubocop

# Type checking (if using Sorbet/RBS)
bundle exec srb tc
```

**Remix:**
```bash
# Linting
npm run lint

# Type checking
npm run typecheck
```

## Production Deployment

### Rails

**Recommended hosting**: Heroku, Railway, Render, or AWS ECS

```bash
# Dockerfile example
FROM ruby:3.3
WORKDIR /app
COPY Gemfile* ./
RUN bundle install
COPY . .
CMD ["rails", "server", "-b", "0.0.0.0"]
```

**Environment**:
- Set `RAILS_ENV=production`
- Use production database (PostgreSQL)
- Enable Rails credentials: `rails credentials:edit`
- Set `RAILS_LOG_TO_STDOUT=true` for container logs

### Remix

**Recommended hosting**: Vercel, Netlify, Fly.io, or Cloudflare Pages

```bash
# Build
npm run build

# Start
npm start
```

**Environment**:
- Set `NODE_ENV=production`
- Update `MCP_SERVER_URL` to production Rails URL
- Use secure HTTPS for all connections

### Nginx Configuration (SSE Support)

```nginx
location /mcp/sse {
    proxy_pass http://rails_backend;
    proxy_http_version 1.1;
    proxy_set_header Connection "";
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

    # Critical for SSE
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;
}
```

## Extending the Platform

### Adding New Data Sources

1. Create a new service class:
```ruby
# app/services/hubspot_client.rb
class HubspotClient
  def self.fetch_contact(email)
    # HubSpot API call
  end
end
```

2. Update `AggregateCustomerContext` tool:
```ruby
def call(email:, include_historical: false)
  # ...existing code...
  hubspot_data = fetch_hubspot_data(email)

  context = {
    # ...
    platforms: {
      shopify: shopify_data,
      salesforce: salesforce_data,
      klaviyo: klaviyo_data,
      hubspot: hubspot_data  # New!
    }
  }
end
```

### Adding New AI Capabilities

- Predictive analytics (churn prediction, LTV forecasting)
- Sentiment analysis on support tickets
- Personalized marketing copy generation
- Inventory optimization recommendations

## License

MIT

## Support

For issues or questions:
- GitHub Issues: [Create an issue](https://github.com/your-org/unified-merchant-ops/issues)
- Email: support@merchant-ops.example.com

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Anthropic Claude](https://www.anthropic.com/claude)
- [fast-mcp gem](https://github.com/yjacquin/fast-mcp)
- [Remix](https://remix.run/)
