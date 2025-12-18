/**
 * Home Route
 *
 * Main entry point for MerchantAI - the AI-powered command center
 * for unified merchant operations.
 */

import type { MetaFunction } from '@remix-run/node';
import MerchantChat from '~/components/MerchantChat';

export const meta: MetaFunction = () => {
  return [
    { title: 'MerchantAI - Unified Operations Command Center' },
    {
      name: 'description',
      content: 'AI-powered command center for unified merchant operations. Get instant insights across Shopify, Salesforce, Klaviyo, and Cin7.',
    },
    { name: 'theme-color', content: '#0f172a' },
    { property: 'og:title', content: 'MerchantAI - Unified Operations Command Center' },
    { property: 'og:description', content: 'AI-powered command center for unified merchant operations.' },
    { property: 'og:type', content: 'website' },
  ];
};

export default function Index() {
  return <MerchantChat />;
}
