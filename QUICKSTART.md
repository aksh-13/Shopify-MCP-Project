# Quick Start Guide

Get the Unified Merchant Operations Platform running in 5 minutes!

## Prerequisites

✅ **Ruby 3.3.0** installed (`ruby --version`)
✅ **Node.js 20+** installed (`node --version`)
✅ **PostgreSQL** running (`psql --version`)
✅ **Anthropic API Key** ([Get one here](https://console.anthropic.com/))

## Step 1: Clone and Setup Rails Backend

```bash
cd rails-mcp-server

# Install gems
bundle install

# Create environment file
cp .env.example .env

# Edit .env and set these values:
# MCP_API_KEY=my-secret-key-123
# (You can use any random string for development)

# Setup database
rails db:create db:migrate

# Start Rails server
rails server
```

**Expected output:**
```
=> Booting Puma
=> Rails 7.2.0 application starting in development
* Listening on http://127.0.0.1:3000
```

Keep this terminal open!

## Step 2: Setup Remix Frontend

Open a **new terminal**:

```bash
cd remix-mcp-client

# Install dependencies
npm install

# Create environment file
cp .env.example .env

# Edit .env and set these values:
# MCP_SERVER_URL=http://localhost:3000/mcp/sse
# MCP_API_KEY=my-secret-key-123  (same as Rails)
# ANTHROPIC_API_KEY=sk-ant-api03-YOUR-KEY-HERE

# Start Remix dev server
npm run dev
```

**Expected output:**
```
 ➜  Local:   http://localhost:3001/
 ➜  Network: use --host to expose
```

## Step 3: Test the Platform

### Open the UI

1. Open your browser to: **http://localhost:3001**
2. You should see the chat interface!

### Try a Query

In the chat input, type:

```
Show me the context for jane.doe@example.com
```

**What will happen:**

1. Your message is sent to Claude
2. Claude decides to use the `aggregate_customer_context` tool
3. The tool fetches mock data from Shopify, Salesforce, Klaviyo, and Cin7
4. Claude analyzes the data and responds with insights

**Expected response** (approximately):

```
Jane Doe has been a customer since 2022-12-11 with a lifetime value of
$2,450.50 across 12 orders. Last order was 15 days ago.

CRM status: Active Customer (Gold tier). 1 open support case(s).

Email engagement is strong (score: 8.5/10). Predicted next purchase in 12 days.

Recommendations:
• High-value customer ($2,450.50 LTV). Consider personal outreach or VIP
  program invite.
• Highly engaged email subscriber. Good candidate for new product launches.
• Active support case. Ensure resolution before next marketing campaign.
```

## Step 4: Explore the Tools

### Test MCP Tools Directly (Optional)

You can test tools via HTTP without the UI:

```bash
# List available tools
curl http://localhost:3000/mcp/tools \
  -H "X-MCP-Api-Key: my-secret-key-123"

# Execute a tool
curl -X POST http://localhost:3000/mcp/tools/aggregate_customer_context \
  -H "X-MCP-Api-Key: my-secret-key-123" \
  -H "Content-Type: application/json" \
  -d '{"email": "customer@example.com", "include_historical": true}'
```

### Check MCP Connection Status

```bash
curl http://localhost:3001/api/chat
```

Should return:
```json
{
  "status": "ok",
  "mcp": {
    "connected": true,
    "toolCount": 2,
    "tools": ["aggregate_customer_context", "refund_order"]
  }
}
```

## Troubleshooting

### "Cannot connect to database"

**Problem**: Rails can't connect to PostgreSQL

**Solution**:
```bash
# Make sure PostgreSQL is running
brew services start postgresql@14  # macOS
sudo service postgresql start       # Linux

# Create the database
rails db:create
```

### "MCP_API_KEY is required"

**Problem**: Environment variables not loaded

**Solution**:
```bash
# Check .env file exists
ls -la .env

# Restart the server
# Rails and Remix both auto-load .env via dotenv
```

### "Invalid Anthropic API key"

**Problem**: Wrong API key format or invalid key

**Solution**:
1. Go to https://console.anthropic.com/
2. Generate a new API key
3. Copy the full key (starts with `sk-ant-api03-`)
4. Update `remix-mcp-client/.env`:
   ```
   ANTHROPIC_API_KEY=sk-ant-api03-YOUR-KEY-HERE
   ```
5. Restart Remix: `npm run dev`

### "SSE connection failed"

**Problem**: MCP client can't connect to Rails

**Solution**:
```bash
# 1. Check Rails is running
curl http://localhost:3000/up

# 2. Check API key matches in both .env files
cat rails-mcp-server/.env | grep MCP_API_KEY
cat remix-mcp-client/.env | grep MCP_API_KEY

# 3. Check CORS (should see "Access-Control-Allow-Origin" header)
curl -I http://localhost:3000/mcp/sse -H "X-MCP-Api-Key: my-secret-key-123"
```

### "Port 3000 already in use"

**Problem**: Another app is using port 3000

**Solution**:
```bash
# Option 1: Kill the other process
lsof -ti:3000 | xargs kill -9

# Option 2: Run Rails on a different port
rails server -p 3001

# Then update Remix .env:
# MCP_SERVER_URL=http://localhost:3001/mcp/sse
```

## Next Steps

Now that everything is working:

1. **Read the Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md) for design details
2. **Add Real API Calls**: Replace mock data in `app/tools/aggregate_customer_context.rb`
3. **Create New Tools**: Follow the guide in [README.md](./README.md#adding-new-tools)
4. **Customize the UI**: Edit `app/components/MerchantChat.tsx`
5. **Deploy to Production**: See deployment guides in README.md

## Example Queries to Try

```
Show me context for customer@example.com

What's the status of high-value customers?

Aggregate data for jane.doe@example.com with historical info

How are customers engaging with email campaigns?

Show me customers with open support cases
```

## Development Workflow

### Making Changes

**Rails (Backend)**:
```bash
# Changes auto-reload in development
# Just edit files and refresh

# If you change Gemfile:
bundle install

# If you add new tools:
# 1. Create app/tools/my_tool.rb
# 2. Register in config/initializers/fast_mcp.rb
# 3. Restart Rails server
```

**Remix (Frontend)**:
```bash
# Hot module replacement (no restart needed)
# Just edit and save

# If you change package.json:
npm install

# If you add new server modules:
# Remix auto-rebuilds
```

### Viewing Logs

**Rails**:
```bash
tail -f log/development.log
```

**Remix**:
Logs appear in the terminal where you ran `npm run dev`

## Project Structure Reference

```
Shopify MCP Project/
├── rails-mcp-server/          ← Backend (port 3000)
│   ├── app/
│   │   ├── controllers/mcp/   ← SSE endpoint
│   │   └── tools/             ← MCP tools (add new ones here!)
│   ├── config/
│   │   └── initializers/
│   │       └── fast_mcp.rb    ← Register tools here
│   └── .env                   ← API keys and config
│
└── remix-mcp-client/          ← Frontend (port 3001)
    ├── app/
    │   ├── components/        ← React UI components
    │   ├── lib/
    │   │   ├── mcp-client.server.ts    ← MCP connection
    │   │   └── claude-client.server.ts ← Claude integration
    │   └── routes/
    │       ├── _index.tsx     ← Home page (renders MerchantChat)
    │       └── api.chat.tsx   ← Chat API endpoint
    └── .env                   ← API keys and config
```

## Getting Help

- **Documentation**: See [README.md](./README.md) for full docs
- **Architecture**: See [ARCHITECTURE.md](./ARCHITECTURE.md) for deep dive
- **Issues**: Check existing issues or create a new one
- **Logs**: Always check terminal output and log files first

---

**You're all set!** 🎉

The platform is running and ready for development. Start by trying different queries in the chat interface, then explore the code to understand how it works.
