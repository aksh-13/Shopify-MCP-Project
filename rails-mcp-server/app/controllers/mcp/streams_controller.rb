# frozen_string_literal: true

#
# MCP SSE Streaming Controller
#
# This controller implements the Server-Sent Events (SSE) transport for the
# Model Context Protocol. It handles long-lived streaming connections from
# MCP clients (like our Remix frontend).
#
# SSE Protocol Flow:
# 1. Client connects to GET /mcp/sse with X-MCP-Api-Key header
# 2. Server validates auth and sends initial connection event
# 3. Client sends MCP requests (tool calls, resource queries) via the stream
# 4. Server processes and streams responses back
# 5. Connection stays open until client disconnects or timeout
#
# Thread Safety:
# - ActionController::Live spawns a new thread per SSE connection
# - Each thread has its own response stream (response.stream)
# - No shared mutable state between threads
# - FastMcp handles thread-safe tool execution internally
#
# Production Considerations:
# - Monitor open SSE connections (can accumulate if clients don't disconnect cleanly)
# - Set reasonable timeouts (e.g., 30 min for active sessions)
# - Use nginx/load balancer with proper SSE support (buffering off)
# - Consider connection limits per client IP
#

module Mcp
  class StreamsController < ApplicationController
    # Enable Server-Sent Events streaming
    # This includes ActionController::Live which:
    # - Spawns a new thread for this response
    # - Provides response.stream for writing events
    # - Handles connection management
    include ActionController::Live

    # Skip CSRF for SSE endpoint (API-key authenticated)
    skip_before_action :verify_authenticity_token

    # Authenticate all requests with API key
    before_action :authenticate_mcp_client!

    # Set proper SSE headers
    before_action :set_sse_headers

    #
    # GET /mcp/sse
    #
    # Main SSE streaming endpoint. This is the transport layer for MCP protocol.
    # Clients connect here and receive a stream of events.
    #
    def stream
      Rails.logger.info "MCP SSE connection established from #{request.remote_ip}"

      # Send initial connection success event
      write_sse_event(
        event: "connected",
        data: {
          server: "Unified Merchant Operations Platform",
          version: "1.0.0",
          protocol: "mcp/sse",
          timestamp: Time.current.iso8601
        }
      )

      # Initialize MCP session handler
      # This wraps FastMcp's SSE handler and manages the bidirectional flow
      mcp_handler = create_mcp_handler

      # Start the MCP protocol loop
      # This will:
      # 1. Listen for incoming SSE messages from client
      # 2. Parse MCP protocol messages (tool calls, resource queries)
      # 3. Execute tools through FastMcp
      # 4. Stream results back to client
      #
      # The loop continues until:
      # - Client disconnects
      # - Connection timeout (30 minutes)
      # - Server error
      mcp_handler.handle_stream(response.stream, request)

    rescue ActionController::Live::ClientDisconnected
      Rails.logger.info "MCP SSE client disconnected from #{request.remote_ip}"
    rescue Timeout::Error
      Rails.logger.warn "MCP SSE connection timed out for #{request.remote_ip}"
      write_sse_event(event: "timeout", data: { message: "Connection timeout" })
    rescue StandardError => e
      Rails.logger.error "MCP SSE error: #{e.message}\n#{e.backtrace.join("\n")}"
      write_sse_event(
        event: "error",
        data: {
          error: "Internal server error",
          message: e.message,
          timestamp: Time.current.iso8601
        }
      )
    ensure
      # Always close the stream to free up resources
      # This is critical to prevent connection leaks
      response.stream.close unless response.stream.closed?
      Rails.logger.info "MCP SSE stream closed for #{request.remote_ip}"
    end

    private

    #
    # Authentication
    #
    # Validates X-MCP-Api-Key header against environment variable.
    # In production, consider:
    # - Per-client API keys stored in database
    # - JWT tokens with expiration
    # - OAuth 2.0 client credentials flow
    # - IP allowlisting for additional security
    #
    def authenticate_mcp_client!
      api_key = request.headers['X-MCP-Api-Key']
      expected_key = ENV['MCP_API_KEY']

      unless api_key.present? && expected_key.present? && api_key == expected_key
        render json: {
          error: "Unauthorized",
          message: "Invalid or missing X-MCP-Api-Key header"
        }, status: :unauthorized
        return false
      end

      true
    end

    #
    # Set SSE headers
    #
    # These headers are required for proper SSE streaming:
    # - Content-Type: text/event-stream (SSE standard)
    # - Cache-Control: no-cache (prevent proxy caching)
    # - X-Accel-Buffering: no (disable nginx buffering)
    #
    def set_sse_headers
      response.headers['Content-Type'] = 'text/event-stream'
      response.headers['Cache-Control'] = 'no-cache, no-store'
      response.headers['X-Accel-Buffering'] = 'no' # Disable nginx buffering
      response.headers['Connection'] = 'keep-alive'
    end

    #
    # Write SSE event to stream
    #
    # SSE format:
    #   event: event_name
    #   data: {"json": "payload"}
    #   id: optional_event_id
    #   \n\n (double newline terminates event)
    #
    def write_sse_event(event:, data:, id: nil)
      return if response.stream.closed?

      sse_message = ""
      sse_message += "id: #{id}\n" if id
      sse_message += "event: #{event}\n" if event
      sse_message += "data: #{data.to_json}\n\n"

      response.stream.write(sse_message)
    rescue IOError => e
      Rails.logger.warn "Failed to write SSE event: #{e.message}"
      # Stream likely closed, will be handled in ensure block
    end

    #
    # Create MCP handler
    #
    # This creates the FastMcp SSE handler that manages the MCP protocol.
    # The handler is stateless and thread-safe.
    #
    def create_mcp_handler
      FastMcp::SseHandler.new(
        # Timeout for idle connections (30 minutes)
        timeout: 30.minutes.to_i,

        # Callback for tool execution
        on_tool_call: method(:handle_tool_call),

        # Callback for resource queries
        on_resource_query: method(:handle_resource_query),

        # Callback for protocol errors
        on_error: method(:handle_protocol_error)
      )
    end

    #
    # Handle tool call from MCP client
    #
    # Called when the LLM (via Remix) requests a tool execution.
    # This is invoked in the SSE thread, so it must be thread-safe.
    #
    def handle_tool_call(tool_name, parameters)
      Rails.logger.info "Executing MCP tool: #{tool_name} with params: #{parameters.inspect}"

      # FastMcp handles tool lookup and execution
      # Tools are stateless and thread-safe by design
      result = FastMcp.execute_tool(tool_name, parameters)

      # Stream result back to client
      write_sse_event(
        event: "tool_result",
        data: {
          tool: tool_name,
          result: result,
          timestamp: Time.current.iso8601
        }
      )

      result
    rescue StandardError => e
      Rails.logger.error "Tool execution failed: #{e.message}"
      error_result = {
        error: "Tool execution failed",
        tool: tool_name,
        message: e.message
      }

      write_sse_event(event: "tool_error", data: error_result)
      error_result
    end

    #
    # Handle resource query from MCP client
    #
    # Resources are read-only data sources that clients can query.
    # Less common than tools but useful for exposing large datasets.
    #
    def handle_resource_query(resource_uri, parameters = {})
      Rails.logger.info "Querying MCP resource: #{resource_uri}"

      result = FastMcp.query_resource(resource_uri, parameters)

      write_sse_event(
        event: "resource_result",
        data: {
          resource: resource_uri,
          result: result,
          timestamp: Time.current.iso8601
        }
      )

      result
    rescue StandardError => e
      Rails.logger.error "Resource query failed: #{e.message}"
      {
        error: "Resource query failed",
        resource: resource_uri,
        message: e.message
      }
    end

    #
    # Handle protocol-level errors
    #
    # These are errors in the MCP protocol itself (malformed messages, etc.)
    # not in tool execution.
    #
    def handle_protocol_error(error_message)
      Rails.logger.error "MCP protocol error: #{error_message}"

      write_sse_event(
        event: "protocol_error",
        data: {
          error: "Protocol error",
          message: error_message,
          timestamp: Time.current.iso8601
        }
      )
    end
  end
end
