# frozen_string_literal: true

# Puma configuration for MCP Server with SSE support
#
# SSE (Server-Sent Events) Requirements:
# - Multiple concurrent connections (one per active MCP client)
# - Long-lived connections (SSE streams stay open)
# - Thread-safe request handling
#
# Puma Threading Model:
# - Each worker process has a thread pool
# - ActionController::Live uses a separate thread per SSE stream
# - Ensure max_threads is high enough for concurrent SSE clients
#

max_threads_count = ENV.fetch("RAILS_MAX_THREADS", 5)
min_threads_count = ENV.fetch("RAILS_MIN_THREADS") { max_threads_count }
threads min_threads_count, max_threads_count

# Worker processes (only in production, clustering mode)
# For development, single worker is fine
worker_timeout 3600 if ENV.fetch("RAILS_ENV", "development") == "development"

# Port
port ENV.fetch("PORT", 3000)

# Environment
environment ENV.fetch("RAILS_ENV") { "development" }

# Pidfile
pidfile ENV.fetch("PIDFILE") { "tmp/pids/server.pid" }

# Workers (production clustering)
if ENV.fetch("RAILS_ENV", "development") == "production"
  workers ENV.fetch("WEB_CONCURRENCY", 2)

  # Preload app for memory efficiency
  preload_app!

  # Allow puma to be restarted by `bin/rails restart` command
  plugin :tmp_restart
end

# Allow puma to be restarted by `bin/rails restart` command.
plugin :tmp_restart
