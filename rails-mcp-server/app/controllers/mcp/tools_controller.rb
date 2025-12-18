# frozen_string_literal: true

#
# Development-only controller for testing MCP tools directly via HTTP
#
# This is NOT part of the MCP protocol, but useful for:
# - Testing tools without setting up full MCP client
# - Debugging tool implementations
# - API documentation/exploration
#
# Only available in development environment for security.
#

module Mcp
  class ToolsController < ApplicationController
    skip_before_action :verify_authenticity_token
    before_action :ensure_development_environment!
    before_action :authenticate_mcp_client!, only: [:execute]

    #
    # GET /mcp/tools
    #
    # Lists all available MCP tools with their schemas
    #
    def index
      tools = FastMcp.tools.map do |tool_name, tool_config|
        {
          name: tool_name,
          description: tool_config[:description],
          parameters: tool_config[:schema]&.dig(:parameters) || {},
          tool_class: tool_config[:tool_class]
        }
      end

      render json: {
        server: "Unified Merchant Operations Platform",
        version: "1.0.0",
        tools: tools,
        count: tools.size
      }
    end

    #
    # POST /mcp/tools/:tool_name
    #
    # Execute a specific tool directly (bypassing SSE transport)
    #
    # Example:
    #   POST /mcp/tools/aggregate_customer_context
    #   Headers: X-MCP-Api-Key: your-key
    #   Body: { "email": "customer@example.com", "include_historical": true }
    #
    def execute
      tool_name = params[:tool_name]
      parameters = params.except(:tool_name, :controller, :action).permit!.to_h

      result = FastMcp.execute_tool(tool_name, parameters)

      render json: {
        tool: tool_name,
        parameters: parameters,
        result: result,
        executed_at: Time.current.iso8601
      }
    rescue StandardError => e
      render json: {
        error: "Tool execution failed",
        tool: tool_name,
        message: e.message,
        backtrace: Rails.env.development? ? e.backtrace.first(5) : nil
      }, status: :internal_server_error
    end

    private

    def ensure_development_environment!
      unless Rails.env.development?
        render json: {
          error: "Not available",
          message: "Tool testing endpoint only available in development"
        }, status: :forbidden
      end
    end

    def authenticate_mcp_client!
      api_key = request.headers['X-MCP-Api-Key']
      expected_key = ENV['MCP_API_KEY']

      unless api_key.present? && expected_key.present? && api_key == expected_key
        render json: {
          error: "Unauthorized",
          message: "Invalid or missing X-MCP-Api-Key header"
        }, status: :unauthorized
      end
    end
  end
end
