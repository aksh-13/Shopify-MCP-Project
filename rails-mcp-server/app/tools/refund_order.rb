# frozen_string_literal: true

#
# MCP Tool: Refund Order
#
# Purpose:
# Demonstrates a "write" operation through MCP - initiating a refund
# in Shopify for a specific order.
#
# Security Considerations:
# - Validate merchant authorization before refunding
# - Log all refund attempts for audit trail
# - Implement approval workflow for large refunds
# - Check refund eligibility (time limits, return policy)
#

require 'fast_mcp/annotations'

module Tools
  class RefundOrder
    include FastMcp::Annotations

    parameter :order_id,
              type: :string,
              description: "Shopify order ID to refund",
              required: true

    parameter :amount,
              type: :number,
              description: "Refund amount in dollars. If not specified, full refund is issued.",
              required: false

    parameter :reason,
              type: :string,
              description: "Reason for refund (e.g., 'customer_request', 'defective_product')",
              required: false,
              default: "customer_request"

    parameter :notify_customer,
              type: :boolean,
              description: "Whether to send refund confirmation email to customer",
              required: false,
              default: true

    def call(order_id:, amount: nil, reason: "customer_request", notify_customer: true)
      Rails.logger.info "Initiating refund for order #{order_id}"

      # Validate refund eligibility
      order = fetch_order(order_id)
      return error_response("Order not found") unless order

      validate_refund_eligibility!(order, amount)

      # Process refund
      refund_result = process_refund(order_id, amount, reason, notify_customer)

      Rails.logger.info "Refund processed for order #{order_id}: #{refund_result[:refund_id]}"

      {
        success: true,
        refund_id: refund_result[:refund_id],
        order_id: order_id,
        amount_refunded: refund_result[:amount],
        original_order_total: order[:total],
        reason: reason,
        notification_sent: notify_customer,
        processed_at: Time.current.iso8601
      }
    rescue StandardError => e
      Rails.logger.error "Refund failed for order #{order_id}: #{e.message}"
      error_response(e.message)
    end

    private

    def fetch_order(order_id)
      # MOCK - Replace with Shopify API call
      {
        id: order_id,
        total: 125.99,
        created_at: 10.days.ago.iso8601,
        financial_status: "paid",
        fulfillment_status: "fulfilled"
      }
    end

    def validate_refund_eligibility!(order, amount)
      # Check if order is refundable
      raise "Order not paid yet" unless order[:financial_status] == "paid"

      # Check refund window (e.g., 30 days)
      order_age_days = (Time.current - Time.parse(order[:created_at])) / 1.day
      raise "Order too old to refund (>30 days)" if order_age_days > 30

      # Validate amount
      if amount && amount > order[:total]
        raise "Refund amount ($#{amount}) exceeds order total ($#{order[:total]})"
      end

      true
    end

    def process_refund(order_id, amount, reason, notify_customer)
      # MOCK - Replace with Shopify Refund API call
      # Real implementation:
      # refund = ShopifyAPI::Refund.create(
      #   order_id: order_id,
      #   currency: "USD",
      #   notify: notify_customer,
      #   note: reason,
      #   refund_line_items: calculate_line_items(order_id, amount)
      # )

      {
        refund_id: "refund_#{SecureRandom.hex(6)}",
        amount: amount || 125.99
      }
    end

    def error_response(message)
      {
        success: false,
        error: message,
        processed_at: Time.current.iso8601
      }
    end
  end
end
