# frozen_string_literal: true

#
# CORS Configuration for MCP SSE Endpoint
#
# SSE connections from browser-based clients (or server-side Remix fetches)
# require proper CORS headers. Since we're using server-side MCP client in Remix,
# we can be more restrictive.
#
# Security Notes:
# - In production, replace '*' with specific Remix frontend origin(s)
# - SSE endpoint is further protected by X-MCP-Api-Key header
# - Consider IP allowlisting for additional security
#

Rails.application.config.middleware.insert_before 0, Rack::Cors do
  allow do
    # Development: Allow Remix dev server (typically http://localhost:3001 or 5173)
    # Production: Replace with your deployed Remix app domain
    origins Rails.env.production? ? ENV.fetch('FRONTEND_ORIGIN', 'https://merchant-ops.example.com') : '*'

    resource '/mcp/*',
      headers: :any,
      methods: [:get, :post, :options],
      credentials: false, # SSE works without credentials when using API key header
      max_age: 600 # Cache preflight for 10 minutes
  end
end
