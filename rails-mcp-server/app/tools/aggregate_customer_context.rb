# frozen_string_literal: true

#
# ═══════════════════════════════════════════════════════════════════════════════
# MCP TOOL: Aggregate Customer Context
# ═══════════════════════════════════════════════════════════════════════════════
#
# PURPOSE:
# This tool solves the core "data fragmentation" problem in merchant operations.
# Merchants use multiple SaaS platforms that don't communicate with each other:
#
#   Shopify     → E-commerce orders, products, customers
#   Salesforce  → CRM, support tickets, sales pipeline
#   Klaviyo     → Email marketing, engagement metrics
#   Cin7        → Inventory management, invoicing
#
# When a merchant asks "How is Jane Doe doing?", they need a unified view that
# synthesizes data from all these platforms. This tool provides that synthesis.
#
# ═══════════════════════════════════════════════════════════════════════════════
# LLM-FRIENDLY DESIGN DECISIONS
# ═══════════════════════════════════════════════════════════════════════════════
#
# The output structure is specifically designed for LLM consumption:
#
# 1. HIERARCHICAL STRUCTURE:
#    └── platforms (raw data for detailed queries)
#        ├── shopify
#        ├── salesforce
#        └── klaviyo
#    └── summary (human-readable prose)
#    └── recommendations (actionable items)
#
#    The LLM can quickly scan `summary` for context, then drill into `platforms`
#    for specifics. This mirrors how a human would read a report.
#
# 2. PRE-COMPUTED INSIGHTS:
#    We don't just return raw data. We compute:
#    - Lifetime value calculations
#    - Customer tenure
#    - Engagement scores
#    - Churn risk indicators
#
#    Alternative: Return raw data and let the LLM compute insights.
#    Rejected: LLMs make arithmetic errors. Business logic belongs in code.
#
# 3. NATURAL LANGUAGE SUMMARY:
#    The `summary` field is prose that the LLM can quote directly.
#    Example: "Jane Doe has been a customer since 2022 with $2,450 LTV..."
#
#    This is more useful than: { "ltv": 2450, "customer_since": "2022-01-15" }
#    The LLM doesn't have to figure out how to phrase it.
#
# 4. ACTIONABLE RECOMMENDATIONS:
#    Each recommendation has:
#    - type: Category (upsell, engagement, support, reengagement)
#    - priority: How urgent (high, medium, low)
#    - message: What action to take
#
#    The LLM can use these to proactively suggest actions to the merchant.
#
# ═══════════════════════════════════════════════════════════════════════════════
# THREAD SAFETY ANALYSIS
# ═══════════════════════════════════════════════════════════════════════════════
#
# This class follows a STATELESS design pattern:
#
# ✓ NO INSTANCE VARIABLES that persist across calls
# ✓ NO CLASS VARIABLES (@@)
# ✓ NO MODULE GLOBALS
# ✓ Each `call` invocation is completely independent
#
# When FastMcp executes this tool:
# 1. It instantiates a new AggregateCustomerContext object
# 2. Calls `#call` with parameters
# 3. Discards the instance
#
# Even if two threads execute this tool concurrently with different emails,
# they operate on completely separate object instances.
#
# DANGER ZONE: The mock implementations below are stateless. When you replace
# them with real API clients, ensure those clients are thread-safe:
# - Use connection pools (RestClient, Faraday)
# - Don't share mutable state across requests
# - Consider using Concurrent::Future for parallel fetches
#
# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTION MIGRATION CHECKLIST
# ═══════════════════════════════════════════════════════════════════════════════
#
# Each fetch method has a MOCK implementation. For production:
#
# [ ] fetch_shopify_data:
#     - Install shopify_api gem
#     - Implement OAuth for merchant authorization
#     - Cache responses in Redis (TTL: 5-15 min)
#     - Handle rate limits (Shopify: 2 req/sec)
#
# [ ] fetch_salesforce_data:
#     - Install restforce gem
#     - Implement JWT bearer flow for server-to-server auth
#     - Use SOQL for efficient queries
#     - Handle token refresh
#
# [ ] fetch_klaviyo_data:
#     - Use Klaviyo API v3 (newest, best documented)
#     - Private API key authentication
#     - Consider webhooks for real-time engagement data
#
# [ ] fetch_cin7_data:
#     - Use Cin7 Core API (REST)
#     - Basic auth with API key
#     - Large historical queries may need pagination
#
# [ ] Error handling:
#     - Circuit breakers for each API (Stoplight gem)
#     - Retry with exponential backoff
#     - Graceful degradation (return partial data if one API fails)
#
# [ ] Performance:
#     - Parallel fetches (Concurrent::Future or async)
#     - Response caching (Redis)
#     - Background jobs for slow aggregations
#

require 'fast_mcp/annotations'

module Tools
  class AggregateCustomerContext
    include FastMcp::Annotations

    # ─────────────────────────────────────────────────────────────────────────
    # PARAMETER DEFINITIONS
    # ─────────────────────────────────────────────────────────────────────────
    #
    # These annotations define the tool's input schema for the MCP protocol.
    # They get converted to JSON Schema and sent to the LLM, which uses them
    # to construct valid tool calls.
    #
    # DESIGN DECISION: Email as primary key
    #
    # Alternative considered: Customer ID (platform-specific like shopify_id)
    # Rejected because:
    # 1. Merchants know customers by email, not internal IDs
    # 2. Email is the common key across all platforms
    # 3. LLM can extract email from natural language ("Show me jane@example.com")
    #
    # Tradeoff: Email-based lookup may be slower than ID lookup.
    # Mitigation: Index on email in each platform, caching layer.
    #
    parameter :email,
              type: :string,
              description: "Customer email address. The primary identifier used to look up customer data across all platforms.",
              required: true,
              pattern: /\A[\w+\-.]+@[a-z\d\-]+(\.[a-z\d\-]+)*\.[a-z]+\z/i

    #
    # DESIGN DECISION: Optional historical data
    #
    # Cin7 (inventory) data includes full order history, which can be large.
    # By default, we skip it for faster responses. The LLM can request it
    # when the merchant specifically asks about historical patterns.
    #
    parameter :include_historical,
              type: :boolean,
              description: "Include historical order data from Cin7 (inventory system). Enable for questions about purchase patterns over time. Default: false for faster responses.",
              required: false,
              default: false

    #
    # FUTURE: Add platform filter parameter
    #
    # parameter :platforms,
    #           type: :array,
    #           items: { type: :string, enum: %w[shopify salesforce klaviyo cin7] },
    #           description: "Optional: Limit aggregation to specific platforms",
    #           required: false

    # ─────────────────────────────────────────────────────────────────────────
    # MAIN EXECUTION
    # ─────────────────────────────────────────────────────────────────────────
    #
    # Entry point called by FastMcp when the LLM invokes this tool.
    #
    # @param email [String] Customer email address
    # @param include_historical [Boolean] Whether to fetch Cin7 historical data
    # @return [Hash] Aggregated customer context
    #
    def call(email:, include_historical: false)
      started_at = Time.current
      Rails.logger.info "[AggregateCustomerContext] Started for: #{email}"

      # ────────────────────────────────────────────────────────────────
      # FETCH DATA FROM EACH PLATFORM
      # ────────────────────────────────────────────────────────────────
      #
      # DESIGN DECISION: Sequential fetches (current) vs. parallel fetches
      #
      # Current: Sequential for simplicity in this mock implementation.
      #
      # Production recommendation: Use Concurrent::Future for parallel:
      #
      #   futures = {
      #     shopify: Concurrent::Future.execute { fetch_shopify_data(email) },
      #     salesforce: Concurrent::Future.execute { fetch_salesforce_data(email) },
      #     klaviyo: Concurrent::Future.execute { fetch_klaviyo_data(email) }
      #   }
      #   shopify_data = futures[:shopify].value!
      #   salesforce_data = futures[:salesforce].value!
      #   klaviyo_data = futures[:klaviyo].value!
      #
      # Benefits:
      # - 3x faster if each API call takes ~200ms (600ms → 200ms)
      # - Independent failures (one API down doesn't block others)
      #
      # Tradeoffs:
      # - Slightly more complex error handling
      # - Harder to debug (interleaved logs)
      #

      shopify_data = fetch_shopify_data(email)
      salesforce_data = fetch_salesforce_data(email)
      klaviyo_data = fetch_klaviyo_data(email)

      # Cin7 is optional and potentially slow (full history)
      cin7_data = include_historical ? fetch_cin7_data(email) : nil

      # ────────────────────────────────────────────────────────────────
      # BUILD RESPONSE STRUCTURE
      # ────────────────────────────────────────────────────────────────
      #
      # Structure is optimized for LLM consumption:
      # - Top-level metadata for context
      # - Raw platform data for detailed queries
      # - Pre-computed summary for quick understanding
      # - Actionable recommendations for proactive assistance
      #
      context = {
        # ─── Metadata ───
        email: email,
        aggregated_at: Time.current.iso8601,
        response_time_ms: ((Time.current - started_at) * 1000).round,
        data_sources: build_data_sources_metadata(shopify_data, salesforce_data, klaviyo_data, cin7_data),

        # ─── Raw Platform Data ───
        # Nested under 'platforms' so the LLM knows where to look for specifics
        platforms: {
          shopify: shopify_data,
          salesforce: salesforce_data,
          klaviyo: klaviyo_data,
          cin7: cin7_data
        }.compact,

        # ─── LLM-Friendly Sections ───
        summary: generate_summary(shopify_data, salesforce_data, klaviyo_data, cin7_data),
        key_metrics: extract_key_metrics(shopify_data, salesforce_data, klaviyo_data),
        recommendations: generate_recommendations(shopify_data, salesforce_data, klaviyo_data),

        # ─── Risk Indicators ───
        # Flag potential issues the LLM should be aware of
        alerts: generate_alerts(shopify_data, salesforce_data)
      }

      Rails.logger.info "[AggregateCustomerContext] Completed for #{email} in #{context[:response_time_ms]}ms"
      context

    rescue StandardError => e
      # ────────────────────────────────────────────────────────────────
      # ERROR HANDLING
      # ────────────────────────────────────────────────────────────────
      #
      # DESIGN DECISION: Return error object, don't raise exception
      #
      # The LLM needs to understand what went wrong to respond appropriately.
      # A structured error lets the LLM say "I couldn't fetch customer data
      # because X. Would you like to try again?"
      #
      # Alternative: Raise exception, let FastMcp handle it
      # Rejected: Less control over error structure, generic error messages
      #
      Rails.logger.error "[AggregateCustomerContext] Failed for #{email}: #{e.message}"
      Rails.logger.error e.backtrace.first(10).join("\n")

      {
        error: true,
        error_type: e.class.name,
        error_message: e.message,
        email: email,
        partial_data: attempt_partial_aggregation(email),
        suggestion: "Try again or ask about a different customer."
      }
    end

    private

    # ─────────────────────────────────────────────────────────────────────────
    # PLATFORM DATA FETCHERS
    # ─────────────────────────────────────────────────────────────────────────
    #
    # Each method returns a Hash with platform-specific customer data.
    # Current: MOCK DATA for development/demo.
    # Production: Replace with real API calls.
    #

    #
    # SHOPIFY DATA
    # ────────────
    # E-commerce orders, customer lifetime value, tags
    #
    # Production implementation:
    #   client = ShopifyAPI::Clients::Rest::Admin.new(session: @session)
    #   customer = client.get(path: "customers/search.json", query: { query: "email:#{email}" })
    #   orders = client.get(path: "orders.json", query: { customer_id: customer.id, limit: 10 })
    #
    def fetch_shopify_data(email)
      # MOCK DATA - Simulates Shopify Admin API response
      {
        customer_id: "shopify_#{SecureRandom.hex(4)}",
        first_name: "Jane",
        last_name: "Doe",
        full_name: "Jane Doe", # Pre-computed for LLM convenience

        # ─── Financial Metrics ───
        lifetime_value: 2_450.50,
        total_orders: 12,
        average_order_value: 204.21, # Pre-computed

        # ─── Last Order Details ───
        # Structured for easy LLM access
        last_order: {
          id: "order_#{SecureRandom.hex(4)}",
          date: 15.days.ago.iso8601,
          total: 125.99,
          status: "fulfilled",
          line_items_count: 3
        },

        # ─── Customer Tenure ───
        customer_since: 2.years.ago.to_date.iso8601,
        tenure_days: (Time.current - 2.years.ago).to_i / 86_400, # Pre-computed

        # ─── Segmentation ───
        tags: ["VIP", "repeat_customer"],
        accepts_marketing: true,

        # ─── Contact Info ───
        phone: "+1-555-0123",
        verified_email: true
      }
    end

    #
    # SALESFORCE DATA
    # ────────────────
    # CRM status, support cases, opportunities
    #
    # Production implementation:
    #   client = Restforce.new(
    #     oauth_token: ENV['SALESFORCE_ACCESS_TOKEN'],
    #     instance_url: ENV['SALESFORCE_INSTANCE_URL']
    #   )
    #   contact = client.query("SELECT Id, Name, AccountId FROM Contact WHERE Email = '#{email}'").first
    #
    def fetch_salesforce_data(email)
      # MOCK DATA - Simulates Salesforce REST API response
      {
        contact_id: "sf_contact_#{SecureRandom.hex(4)}",
        account_id: "sf_account_#{SecureRandom.hex(4)}",

        # ─── CRM Status ───
        crm_status: "Active Customer",
        account_tier: "Gold",

        # ─── Support Cases ───
        # Critical for LLM to know if customer has open issues
        open_cases: 1,
        total_cases: 5,
        recent_cases: [
          {
            case_number: "CASE-00#{rand(1000..9999)}",
            status: "In Progress",
            priority: "Medium",
            subject: "Product inquiry about bulk pricing",
            created_at: 3.days.ago.iso8601,
            days_open: 3 # Pre-computed
          }
        ],

        # ─── Account Management ───
        account_manager: {
          name: "Sarah Johnson",
          email: "sjohnson@merchant-ops.example.com"
        },

        # ─── Sales Pipeline ───
        # Opportunities in progress
        opportunities: [
          {
            name: "Q4 2024 Expansion",
            stage: "Qualification",
            probability: 0.20,
            amount: 5_000.00,
            close_date: 45.days.from_now.to_date.iso8601
          }
        ]
      }
    end

    #
    # KLAVIYO DATA
    # ────────────
    # Email engagement, predicted behaviors
    #
    # Production implementation:
    #   client = HTTP.auth("Klaviyo-API-Key #{ENV['KLAVIYO_API_KEY']}")
    #   response = client.get("https://a.klaviyo.com/api/profiles/",
    #     params: { filter: "equals(email,'#{email}')" })
    #
    def fetch_klaviyo_data(email)
      # MOCK DATA - Simulates Klaviyo API v3 response
      {
        profile_id: "klaviyo_#{SecureRandom.hex(4)}",

        # ─── Subscription Status ───
        subscribed: true,
        subscription_date: 18.months.ago.to_date.iso8601,

        # ─── Engagement Metrics ───
        # These are highly valuable for LLM reasoning
        email_engagement: {
          last_opened: 2.days.ago.iso8601,
          last_clicked: 5.days.ago.iso8601,
          engagement_score: 8.5, # 0-10 scale
          avg_open_rate: 0.42,
          avg_click_rate: 0.15,
          emails_received_30d: 8,
          emails_opened_30d: 4
        },

        # ─── Segmentation ───
        segments: ["High Value Customers", "Engaged Last 30 Days"],
        lists: ["Newsletter", "Product Updates"],

        # ─── Marketing Automation ───
        flows: {
          active: ["Post Purchase Flow", "VIP Nurture"],
          completed: ["Welcome Series"],
          exited: []
        },

        # ─── Predictions ───
        # Klaviyo's predictive analytics
        predicted_next_order_date: 12.days.from_now.to_date.iso8601,
        predicted_clv: 3_200.00,
        churn_risk: "low" # low, medium, high
      }
    end

    #
    # CIN7 DATA
    # ─────────
    # Inventory, invoices, order fulfillment
    #
    # Only fetched when include_historical is true (can be slow)
    #
    def fetch_cin7_data(email)
      # MOCK DATA - Simulates Cin7 Core API response
      {
        # ─── Invoice History ───
        total_invoices: 8,
        total_invoiced_amount: 1_890.75,
        last_invoice_date: 20.days.ago.iso8601,

        # ─── Order Status ───
        pending_shipments: [],
        backorders: [],

        # ─── Purchase Patterns ───
        # Useful for understanding customer preferences
        favorite_products: [
          { sku: "PROD-001", name: "Premium Widget", quantity_ordered: 24, times_purchased: 6 },
          { sku: "PROD-015", name: "Deluxe Gadget", quantity_ordered: 12, times_purchased: 4 }
        ],

        # ─── Fulfillment Metrics ───
        average_delivery_time_days: 3.2,
        on_time_delivery_rate: 0.95
      }
    end

    # ─────────────────────────────────────────────────────────────────────────
    # COMPUTED FIELDS & SUMMARIES
    # ─────────────────────────────────────────────────────────────────────────

    #
    # Build metadata about which sources contributed data
    #
    def build_data_sources_metadata(shopify, salesforce, klaviyo, cin7)
      sources = []
      sources << { name: "shopify", status: shopify ? "success" : "unavailable" }
      sources << { name: "salesforce", status: salesforce ? "success" : "unavailable" }
      sources << { name: "klaviyo", status: klaviyo ? "success" : "unavailable" }
      sources << { name: "cin7", status: cin7 ? "success" : "skipped" } unless cin7.nil?
      sources
    end

    #
    # Generate a human-readable summary for LLM consumption
    #
    # DESIGN DECISION: Prose format vs. bullet points
    # We use prose because:
    # 1. LLMs can quote it directly in responses
    # 2. More natural for merchant-facing communication
    # 3. Easier to read in logs
    #
    def generate_summary(shopify, salesforce, klaviyo, cin7)
      return "No customer data found across any platform." if shopify.nil? && salesforce.nil?

      paragraphs = []

      # Paragraph 1: Identity & Value
      if shopify
        paragraphs << [
          "#{shopify[:full_name]} has been a customer since #{shopify[:customer_since]}",
          "(#{shopify[:tenure_days]} days).",
          "Their lifetime value is $#{'%.2f' % shopify[:lifetime_value]}",
          "across #{shopify[:total_orders]} orders",
          "(average order: $#{'%.2f' % shopify[:average_order_value]}).",
          shopify[:tags].include?("VIP") ? "They are tagged as VIP." : nil
        ].compact.join(" ")
      end

      # Paragraph 2: Recent Activity
      if shopify&.dig(:last_order, :date)
        days_since = (Time.current - Time.parse(shopify[:last_order][:date])) / 1.day
        paragraphs << "Last order was #{days_since.to_i} days ago (#{shopify[:last_order][:status]}, $#{'%.2f' % shopify[:last_order][:total]})."
      end

      # Paragraph 3: CRM Status
      if salesforce
        crm_note = "CRM status: #{salesforce[:crm_status]} (#{salesforce[:account_tier]} tier)."
        crm_note += " Account manager: #{salesforce.dig(:account_manager, :name)}." if salesforce.dig(:account_manager, :name)
        paragraphs << crm_note

        if salesforce[:open_cases]&.positive?
          paragraphs << "⚠️ #{salesforce[:open_cases]} open support case(s) requiring attention."
        end
      end

      # Paragraph 4: Engagement
      if klaviyo
        engagement = klaviyo[:email_engagement]
        paragraphs << [
          "Email engagement is #{engagement[:engagement_score] >= 7 ? 'strong' : 'moderate'}",
          "(score: #{engagement[:engagement_score]}/10,",
          "#{(engagement[:avg_open_rate] * 100).round}% open rate).",
          "Predicted next purchase: #{klaviyo[:predicted_next_order_date]}.",
          klaviyo[:churn_risk] == "high" ? "⚠️ High churn risk detected." : nil
        ].compact.join(" ")
      end

      paragraphs.join("\n\n")
    end

    #
    # Extract key metrics as a flat structure for quick reference
    #
    def extract_key_metrics(shopify, salesforce, klaviyo)
      {
        lifetime_value: shopify&.dig(:lifetime_value),
        total_orders: shopify&.dig(:total_orders),
        days_since_last_order: calculate_days_since_last_order(shopify),
        crm_tier: salesforce&.dig(:account_tier),
        open_support_cases: salesforce&.dig(:open_cases),
        email_engagement_score: klaviyo&.dig(:email_engagement, :engagement_score),
        churn_risk: klaviyo&.dig(:churn_risk),
        predicted_clv: klaviyo&.dig(:predicted_clv)
      }.compact
    end

    #
    # Generate actionable recommendations for the merchant
    #
    # DESIGN DECISION: Structured recommendations vs. free text
    #
    # Structured format enables:
    # 1. LLM can filter by type or priority
    # 2. Frontend can render as clickable actions
    # 3. Analytics can track which recommendations are surfaced
    #
    def generate_recommendations(shopify, salesforce, klaviyo)
      recommendations = []

      # ─── HIGH VALUE CUSTOMER ───
      if shopify && shopify[:lifetime_value] > 2000
        recommendations << {
          type: "upsell",
          priority: "high",
          title: "High-Value Customer Opportunity",
          message: "Customer has $#{'%.2f' % shopify[:lifetime_value]} LTV. Consider personal outreach, exclusive offers, or VIP program enrollment.",
          suggested_actions: ["Send personal thank you email", "Offer early access to new products", "Invite to VIP program"]
        }
      end

      # ─── HIGHLY ENGAGED EMAIL SUBSCRIBER ───
      if klaviyo && klaviyo.dig(:email_engagement, :engagement_score) > 7
        recommendations << {
          type: "engagement",
          priority: "medium",
          title: "Capitalize on High Engagement",
          message: "Email engagement score is #{klaviyo.dig(:email_engagement, :engagement_score)}/10. This customer actively reads emails.",
          suggested_actions: ["Include in new product launches", "Send exclusive offers", "Request product reviews"]
        }
      end

      # ─── OPEN SUPPORT CASE ───
      if salesforce && salesforce[:open_cases]&.positive?
        case_info = salesforce[:recent_cases]&.first
        recommendations << {
          type: "support",
          priority: "high",
          title: "Resolve Active Support Issue",
          message: "Customer has #{salesforce[:open_cases]} open case(s). #{case_info ? "Latest: '#{case_info[:subject]}' (#{case_info[:status]})." : ''}",
          suggested_actions: ["Check case status", "Escalate if overdue", "Delay marketing until resolved"]
        }
      end

      # ─── DORMANT CUSTOMER ───
      days_since_order = calculate_days_since_last_order(shopify)
      if days_since_order && days_since_order > 60
        recommendations << {
          type: "reengagement",
          priority: "medium",
          title: "Win-Back Opportunity",
          message: "No purchase in #{days_since_order} days. Customer may be churning.",
          suggested_actions: ["Send win-back email", "Offer discount code", "Survey for feedback"]
        }
      end

      # ─── CHURN RISK ───
      if klaviyo && klaviyo[:churn_risk] == "high"
        recommendations << {
          type: "retention",
          priority: "high",
          title: "High Churn Risk Alert",
          message: "Klaviyo predicts this customer is at high risk of churning. Immediate intervention recommended.",
          suggested_actions: ["Personal outreach from account manager", "Exclusive retention offer", "Feedback call"]
        }
      end

      recommendations
    end

    #
    # Generate alerts for critical issues
    #
    def generate_alerts(shopify, salesforce)
      alerts = []

      if salesforce && salesforce[:open_cases]&.positive?
        salesforce[:recent_cases]&.each do |c|
          if c[:priority] == "High" || c[:days_open].to_i > 7
            alerts << {
              type: "support",
              severity: "critical",
              message: "Case #{c[:case_number]} is #{c[:priority]} priority and #{c[:days_open]} days old."
            }
          end
        end
      end

      alerts
    end

    #
    # Attempt partial aggregation if full fetch fails
    #
    def attempt_partial_aggregation(email)
      # Try each source independently, return whatever we can get
      {
        shopify: safe_fetch { fetch_shopify_data(email) },
        salesforce: safe_fetch { fetch_salesforce_data(email) },
        klaviyo: safe_fetch { fetch_klaviyo_data(email) }
      }.compact
    end

    def safe_fetch
      yield
    rescue StandardError
      nil
    end

    #
    # Calculate days since last order
    #
    def calculate_days_since_last_order(shopify)
      return nil unless shopify&.dig(:last_order, :date)

      date = Time.parse(shopify[:last_order][:date])
      ((Time.current - date) / 1.day).to_i
    rescue ArgumentError
      nil
    end
  end
end
