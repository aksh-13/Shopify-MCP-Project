# frozen_string_literal: true

Rails.application.routes.draw do
  # Health check endpoint
  get "up" => "rails/health#show", as: :rails_health_check

  # MCP Server endpoints
  namespace :mcp do
    # SSE transport endpoint for MCP protocol
    # This is the primary endpoint that MCP clients connect to
    # Uses Server-Sent Events for efficient streaming of:
    # - Tool call requests
    # - Tool execution results
    # - Streaming LLM responses
    # - Protocol negotiation messages
    get "/sse", to: "streams#stream", as: :sse_stream

    # Optional: HTTP endpoint for debugging/testing tools directly
    # Not part of standard MCP protocol but useful for development
    post "/tools/:tool_name", to: "tools#execute", as: :execute_tool if Rails.env.development?

    # Optional: List available tools (for debugging)
    get "/tools", to: "tools#index", as: :tools if Rails.env.development?
  end

  # API endpoints for direct access (non-MCP)
  namespace :api do
    namespace :v1 do
      resources :customers, only: [:show] do
        member do
          get :aggregate_context
        end
      end
    end
  end
end
