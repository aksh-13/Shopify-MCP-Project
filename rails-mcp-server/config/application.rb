require_relative "boot"

require "rails"
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
require "action_view/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module RailsMcpServer
  class Application < Rails::Application
    # Initialize configuration defaults for Rails 7.2
    config.load_defaults 7.2

    # API-only mode
    config.api_only = true

    # Don't generate system test files.
    config.generators.system_tests = nil

    # Enable ActionController::Live for SSE
    config.middleware.delete Rack::ETag
    config.middleware.delete Rack::Sendfile
  end
end
