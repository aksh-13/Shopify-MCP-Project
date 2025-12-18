/**
 * MerchantChat Component - Redesigned
 *
 * A professional-grade AI command center for merchant operations.
 * Features:
 * - Sidebar with platform integrations and quick actions
 * - Real-time tool execution visualization
 * - Markdown rendering for rich responses
 * - Keyboard shortcuts for power users
 * - Modern, polished design
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useFetcher } from '@remix-run/react';

// Type definitions
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  timestamp: Date;
}

interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  result?: unknown;
}

interface ChatResponse {
  success: boolean;
  message: string;
  toolCalls?: ToolCall[];
  error?: string;
}

interface Platform {
  id: string;
  name: string;
  icon: React.ReactNode;
  color: string;
  status: 'connected' | 'disconnected' | 'syncing';
  lastSync?: string;
}

interface QuickAction {
  id: string;
  label: string;
  prompt: string;
  icon: React.ReactNode;
}

// Platform configuration
const platforms: Platform[] = [
  {
    id: 'shopify',
    name: 'Shopify',
    icon: <ShopifyIcon />,
    color: 'bg-[#96bf48]',
    status: 'connected',
    lastSync: '2 min ago',
  },
  {
    id: 'salesforce',
    name: 'Salesforce',
    icon: <SalesforceIcon />,
    color: 'bg-[#00A1E0]',
    status: 'connected',
    lastSync: '5 min ago',
  },
  {
    id: 'klaviyo',
    name: 'Klaviyo',
    icon: <KlaviyoIcon />,
    color: 'bg-[#2DD4BF]',
    status: 'connected',
    lastSync: '1 min ago',
  },
  {
    id: 'cin7',
    name: 'Cin7',
    icon: <Cin7Icon />,
    color: 'bg-[#FF6B35]',
    status: 'connected',
    lastSync: '3 min ago',
  },
];

// Quick actions
const quickActions: QuickAction[] = [
  {
    id: 'lookup',
    label: 'Customer Lookup',
    prompt: 'Show me the full customer context for ',
    icon: <SearchIcon />,
  },
  {
    id: 'highvalue',
    label: 'High-Value Customers',
    prompt: 'Show me the top high-value customers and their recent activity',
    icon: <StarIcon />,
  },
  {
    id: 'atrisk',
    label: 'At-Risk Customers',
    prompt: 'Which customers are at risk of churning and what can we do about it?',
    icon: <AlertIcon />,
  },
  {
    id: 'recentorders',
    label: 'Recent Orders',
    prompt: 'What are the most recent orders and their status?',
    icon: <PackageIcon />,
  },
];

// Sample recent customers for quick access
const recentCustomers = [
  { email: 'jane.doe@example.com', name: 'Jane Doe', ltv: '$2,450' },
  { email: 'john.smith@shop.com', name: 'John Smith', ltv: '$1,890' },
  { email: 'sarah.wilson@mail.com', name: 'Sarah Wilson', ltv: '$3,200' },
];

export default function MerchantChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeToolCall, setActiveToolCall] = useState<string | null>(null);

  const fetcher = useFetcher<ChatResponse>();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle form submission
  const handleSubmit = useCallback((e?: React.FormEvent, customMessage?: string) => {
    e?.preventDefault();

    const messageToSend = customMessage || inputValue.trim();
    if (!messageToSend) return;

    setInputValue('');

    const newUserMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: messageToSend,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, newUserMessage]);

    const conversationHistory = messages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    fetcher.submit(
      {
        message: messageToSend,
        conversationHistory: JSON.stringify(conversationHistory),
      },
      {
        method: 'POST',
        action: '/api/chat',
        encType: 'application/json',
      }
    );
  }, [inputValue, messages, fetcher]);

  // Handle quick action clicks
  const handleQuickAction = (action: QuickAction) => {
    if (action.id === 'lookup') {
      setInputValue(action.prompt);
      inputRef.current?.focus();
    } else {
      handleSubmit(undefined, action.prompt);
    }
  };

  // Handle customer quick lookup
  const handleCustomerLookup = (email: string) => {
    handleSubmit(undefined, `Show me the full customer context for ${email}`);
  };

  // Handle API response
  useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') {
      const response = fetcher.data;

      if (response.success && response.message) {
        const assistantMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: response.message,
          toolCalls: response.toolCalls,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setActiveToolCall(null);
      } else if (response.error) {
        const errorMessage: Message = {
          id: Date.now().toString(),
          role: 'assistant',
          content: `I encountered an issue: ${response.error}. Please try again.`,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
      }
    }
  }, [fetcher.data, fetcher.state]);

  // Simulate active tool call for better UX
  useEffect(() => {
    if (fetcher.state === 'submitting' || fetcher.state === 'loading') {
      const tools = ['aggregate_customer_context', 'analyzing data', 'generating insights'];
      let index = 0;
      const interval = setInterval(() => {
        setActiveToolCall(tools[index % tools.length]);
        index++;
      }, 2000);
      return () => clearInterval(interval);
    }
  }, [fetcher.state]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Cmd/Ctrl + K to focus input
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      // Cmd/Ctrl + B to toggle sidebar
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setSidebarOpen((prev) => !prev);
      }
      // Escape to clear input
      if (e.key === 'Escape') {
        setInputValue('');
        inputRef.current?.blur();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const isLoading = fetcher.state === 'submitting' || fetcher.state === 'loading';

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? 'w-72' : 'w-0'
        } transition-all duration-300 ease-in-out overflow-hidden bg-slate-900 border-r border-slate-800 flex flex-col`}
      >
        <div className="p-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <SparklesIcon />
            </div>
            <div>
              <h1 className="font-semibold text-white">MerchantAI</h1>
              <p className="text-xs text-slate-400">Command Center</p>
            </div>
          </div>
        </div>

        {/* Connected Platforms */}
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
            Connected Platforms
          </h2>
          <div className="space-y-2">
            {platforms.map((platform) => (
              <div
                key={platform.id}
                className="flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800/50 transition-colors cursor-default"
              >
                <div className={`w-8 h-8 rounded-lg ${platform.color} flex items-center justify-center`}>
                  {platform.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">{platform.name}</div>
                  <div className="text-xs text-slate-500">Synced {platform.lastSync}</div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              </div>
            ))}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="p-4 border-b border-slate-800">
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
            Quick Actions
          </h2>
          <div className="space-y-1">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 text-slate-300 hover:text-white transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span className="text-slate-500">{action.icon}</span>
                <span className="text-sm">{action.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Recent Customers */}
        <div className="p-4 flex-1 overflow-y-auto">
          <h2 className="text-xs font-medium text-slate-500 uppercase tracking-wider mb-3">
            Recent Customers
          </h2>
          <div className="space-y-1">
            {recentCustomers.map((customer) => (
              <button
                key={customer.email}
                onClick={() => handleCustomerLookup(customer.email)}
                disabled={isLoading}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-slate-800 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm font-medium text-slate-300">
                  {customer.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-300 truncate group-hover:text-white">
                    {customer.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate">{customer.email}</div>
                </div>
                <div className="text-xs font-medium text-emerald-500">{customer.ltv}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="p-4 border-t border-slate-800">
          <div className="text-xs text-slate-500 space-y-1">
            <div className="flex justify-between">
              <span>Focus input</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">⌘K</kbd>
            </div>
            <div className="flex justify-between">
              <span>Toggle sidebar</span>
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded text-slate-400">⌘B</kbd>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-slate-800 flex items-center px-4 gap-4 bg-slate-900/50 backdrop-blur-sm">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <MenuIcon />
          </button>
          <div className="flex-1">
            <h2 className="font-medium text-white">Unified Operations</h2>
          </div>
          {isLoading && activeToolCall && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 border border-violet-500/20 rounded-full">
              <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse" />
              <span className="text-xs text-violet-300">
                {activeToolCall === 'aggregate_customer_context'
                  ? 'Fetching customer data...'
                  : activeToolCall === 'analyzing data'
                  ? 'Analyzing across platforms...'
                  : 'Generating insights...'}
              </span>
            </div>
          )}
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto">
          {messages.length === 0 ? (
            <EmptyState onSuggestionClick={(prompt) => handleSubmit(undefined, prompt)} />
          ) : (
            <div className="max-w-3xl mx-auto py-6 px-4 space-y-6">
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} />
              ))}

              {isLoading && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center flex-shrink-0">
                    <SparklesIcon />
                  </div>
                  <div className="flex-1">
                    <div className="bg-slate-800/50 rounded-2xl rounded-tl-sm px-4 py-3 inline-block">
                      <div className="flex items-center gap-2">
                        <LoadingDots />
                        <span className="text-sm text-slate-400">
                          {activeToolCall === 'aggregate_customer_context'
                            ? 'Querying Shopify, Salesforce, Klaviyo, Cin7...'
                            : 'Thinking...'}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="border-t border-slate-800 p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto">
            <form onSubmit={handleSubmit} className="relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="Ask about customers, orders, or get insights..."
                disabled={isLoading}
                className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 pr-24 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                {inputValue && (
                  <button
                    type="button"
                    onClick={() => setInputValue('')}
                    className="p-1.5 text-slate-500 hover:text-white transition-colors"
                  >
                    <XIcon />
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isLoading || !inputValue.trim()}
                  className="px-4 py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-1.5"
                >
                  {isLoading ? (
                    <>
                      <LoadingSpinner />
                      <span>Sending</span>
                    </>
                  ) : (
                    <>
                      <SendIcon />
                      <span>Send</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  );
}

// Empty State Component
function EmptyState({ onSuggestionClick }: { onSuggestionClick: (prompt: string) => void }) {
  const suggestions = [
    {
      icon: <UserIcon />,
      title: 'Customer 360',
      description: 'Get unified view of any customer',
      prompt: 'Show me the full customer context for jane.doe@example.com',
    },
    {
      icon: <TrendingUpIcon />,
      title: 'Business Insights',
      description: 'Analyze trends and patterns',
      prompt: 'What are the key business insights from my recent customer data?',
    },
    {
      icon: <AlertIcon />,
      title: 'Risk Analysis',
      description: 'Identify at-risk customers',
      prompt: 'Which customers are at risk of churning and why?',
    },
    {
      icon: <StarIcon />,
      title: 'Top Performers',
      description: 'Find your best customers',
      prompt: 'Who are my highest lifetime value customers?',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center h-full px-4">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center mb-6">
        <SparklesIcon className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-semibold text-white mb-2">Welcome to MerchantAI</h1>
      <p className="text-slate-400 text-center max-w-md mb-8">
        Your AI-powered command center for unified merchant operations. Get insights across
        Shopify, Salesforce, Klaviyo, and Cin7 instantly.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.title}
            onClick={() => onSuggestionClick(suggestion.prompt)}
            className="flex items-start gap-3 p-4 bg-slate-800/50 hover:bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-xl text-left transition-all group"
          >
            <div className="w-10 h-10 rounded-lg bg-slate-700 group-hover:bg-violet-600/20 flex items-center justify-center text-slate-400 group-hover:text-violet-400 transition-colors flex-shrink-0">
              {suggestion.icon}
            </div>
            <div>
              <div className="font-medium text-white group-hover:text-violet-300 transition-colors">
                {suggestion.title}
              </div>
              <div className="text-sm text-slate-500">{suggestion.description}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// Message Bubble Component
function MessageBubble({ message }: { message: Message }) {
  const [showTools, setShowTools] = useState(false);
  const isUser = message.role === 'user';

  return (
    <div className={`flex items-start gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
          isUser
            ? 'bg-slate-700'
            : 'bg-gradient-to-br from-violet-500 to-fuchsia-500'
        }`}
      >
        {isUser ? <UserIcon /> : <SparklesIcon />}
      </div>

      {/* Content */}
      <div className={`flex-1 min-w-0 ${isUser ? 'flex justify-end' : ''}`}>
        <div
          className={`inline-block max-w-full rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-violet-600 text-white rounded-tr-sm'
              : 'bg-slate-800/50 text-slate-100 rounded-tl-sm'
          }`}
        >
          <div className="prose prose-invert prose-sm max-w-none">
            <FormattedMessage content={message.content} />
          </div>

          {/* Tool calls */}
          {message.toolCalls && message.toolCalls.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-700">
              <button
                onClick={() => setShowTools(!showTools)}
                className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-300 transition-colors"
              >
                <ChevronIcon className={`w-4 h-4 transition-transform ${showTools ? 'rotate-90' : ''}`} />
                <span>
                  {message.toolCalls.length} tool{message.toolCalls.length > 1 ? 's' : ''} used
                </span>
                <span className="text-slate-500">•</span>
                <span className="text-slate-500">
                  {message.toolCalls.map((t) => formatToolName(t.name)).join(', ')}
                </span>
              </button>

              {showTools && (
                <div className="mt-2 space-y-2">
                  {message.toolCalls.map((toolCall, idx) => (
                    <ToolCallCard key={idx} toolCall={toolCall} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div
          className={`text-xs text-slate-500 mt-1 ${isUser ? 'text-right' : ''}`}
        >
          {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>
    </div>
  );
}

// Formatted Message Component (basic markdown support)
function FormattedMessage({ content }: { content: string }) {
  // Split by code blocks first
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className="space-y-2">
      {parts.map((part, index) => {
        if (part.startsWith('```')) {
          // Code block
          const lines = part.slice(3, -3).split('\n');
          const code = lines.slice(1).join('\n');
          return (
            <pre key={index} className="bg-slate-900 rounded-lg p-3 overflow-x-auto">
              <code className="text-xs text-slate-300">{code || lines.join('\n')}</code>
            </pre>
          );
        }

        // Process inline formatting
        return (
          <div key={index} className="whitespace-pre-wrap break-words">
            {part.split('\n').map((line, lineIndex) => {
              // Headers
              if (line.startsWith('### ')) {
                return (
                  <h3 key={lineIndex} className="text-base font-semibold text-white mt-3 mb-1">
                    {line.slice(4)}
                  </h3>
                );
              }
              if (line.startsWith('## ')) {
                return (
                  <h2 key={lineIndex} className="text-lg font-semibold text-white mt-4 mb-2">
                    {line.slice(3)}
                  </h2>
                );
              }
              if (line.startsWith('# ')) {
                return (
                  <h1 key={lineIndex} className="text-xl font-bold text-white mt-4 mb-2">
                    {line.slice(2)}
                  </h1>
                );
              }

              // Bullet points
              if (line.match(/^[-*•]\s/)) {
                return (
                  <div key={lineIndex} className="flex items-start gap-2 ml-2">
                    <span className="text-violet-400 mt-1">•</span>
                    <span>{formatInlineText(line.slice(2))}</span>
                  </div>
                );
              }

              // Numbered lists
              if (line.match(/^\d+\.\s/)) {
                const match = line.match(/^(\d+)\.\s(.*)$/);
                if (match) {
                  return (
                    <div key={lineIndex} className="flex items-start gap-2 ml-2">
                      <span className="text-violet-400 font-medium">{match[1]}.</span>
                      <span>{formatInlineText(match[2])}</span>
                    </div>
                  );
                }
              }

              // Empty line
              if (line.trim() === '') {
                return <div key={lineIndex} className="h-2" />;
              }

              // Regular text
              return (
                <div key={lineIndex}>
                  {formatInlineText(line)}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

// Format inline text (bold, italic, code)
function formatInlineText(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining) {
    // Bold
    const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
    // Inline code
    const codeMatch = remaining.match(/`([^`]+)`/);
    // Email
    const emailMatch = remaining.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/);

    const matches = [
      boldMatch && { type: 'bold', match: boldMatch, index: boldMatch.index },
      codeMatch && { type: 'code', match: codeMatch, index: codeMatch.index },
      emailMatch && { type: 'email', match: emailMatch, index: emailMatch.index },
    ].filter(Boolean).sort((a, b) => (a?.index ?? 0) - (b?.index ?? 0));

    const firstMatch = matches[0];

    if (!firstMatch || firstMatch.index === undefined) {
      parts.push(remaining);
      break;
    }

    // Add text before match
    if (firstMatch.index > 0) {
      parts.push(remaining.slice(0, firstMatch.index));
    }

    // Add formatted text
    if (firstMatch.type === 'bold') {
      parts.push(
        <strong key={key++} className="font-semibold text-white">
          {firstMatch.match![1]}
        </strong>
      );
      remaining = remaining.slice(firstMatch.index + firstMatch.match![0].length);
    } else if (firstMatch.type === 'code') {
      parts.push(
        <code key={key++} className="px-1.5 py-0.5 bg-slate-700 rounded text-violet-300 text-sm">
          {firstMatch.match![1]}
        </code>
      );
      remaining = remaining.slice(firstMatch.index + firstMatch.match![0].length);
    } else if (firstMatch.type === 'email') {
      parts.push(
        <span key={key++} className="text-violet-400">
          {firstMatch.match![1]}
        </span>
      );
      remaining = remaining.slice(firstMatch.index + firstMatch.match![0].length);
    }
  }

  return parts;
}

// Tool Call Card Component
function ToolCallCard({ toolCall }: { toolCall: ToolCall }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-slate-900/50 rounded-lg border border-slate-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-slate-800/50 transition-colors"
      >
        <div className="w-6 h-6 rounded bg-emerald-500/20 flex items-center justify-center">
          <ToolIcon className="w-3 h-3 text-emerald-400" />
        </div>
        <span className="text-sm font-medium text-slate-300 flex-1 text-left">
          {formatToolName(toolCall.name)}
        </span>
        <ChevronIcon className={`w-4 h-4 text-slate-500 transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Input</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto text-slate-400">
              {JSON.stringify(toolCall.input, null, 2)}
            </pre>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Result</div>
            <pre className="text-xs bg-slate-900 p-2 rounded overflow-x-auto max-h-40 overflow-y-auto text-slate-400">
              {typeof toolCall.result === 'string'
                ? toolCall.result.slice(0, 500) + (toolCall.result.length > 500 ? '...' : '')
                : JSON.stringify(toolCall.result, null, 2).slice(0, 500)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// Helper function to format tool names
function formatToolName(name: string): string {
  return name
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Loading Components
function LoadingDots() {
  return (
    <div className="flex gap-1">
      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce" />
      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce [animation-delay:0.15s]" />
      <div className="w-2 h-2 bg-violet-400 rounded-full animate-bounce [animation-delay:0.3s]" />
    </div>
  );
}

function LoadingSpinner() {
  return (
    <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

// Icon Components
function SparklesIcon({ className = 'w-5 h-5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
      />
    </svg>
  );
}

function MenuIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    </svg>
  );
}

function PackageIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}

function TrendingUpIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChevronIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function ToolIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
      />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

// Platform Icons
function ShopifyIcon() {
  return (
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M15.337 23.979l7.216-1.561s-2.604-17.613-2.625-17.73c-.018-.116-.114-.192-.211-.192s-1.929-.136-1.929-.136-1.275-1.274-1.439-1.411c-.045-.037-.075-.057-.121-.074l-.914 21.104h.023zm-1.278-17.731c-.074-.037-.131-.057-.205-.057-.019 0-.614.186-.614.186s-1.304-2.986-3.609-2.986c-.093 0-.186.009-.278.019-.334-.409-.744-.595-1.1-.595-2.736 0-4.034 3.422-4.441 5.161-.998.298-1.706.521-1.799.558-.558.167-.577.186-.651.707-.056.391-1.521 11.677-1.521 11.677l11.396 2.134 2.822-16.804zm-3.478-2.11c0 .037 0 .093-.019.13-.52.149-1.096.335-1.707.521.334-1.3.967-1.932 1.521-2.172.112.279.205.828.205 1.521z" />
    </svg>
  );
}

function SalesforceIcon() {
  return (
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M10.006 5.415a4.195 4.195 0 013.045-1.306c1.56 0 2.954.9 3.69 2.205.63-.3 1.35-.45 2.1-.45 2.85 0 5.159 2.34 5.159 5.22s-2.31 5.22-5.16 5.22c-.45 0-.87-.06-1.29-.165a3.9 3.9 0 01-3.45 2.1c-.6 0-1.17-.135-1.68-.375a4.796 4.796 0 01-4.2 2.49c-2.34 0-4.32-1.665-4.77-3.885-.225.03-.45.045-.69.045C1.2 16.515 0 14.565 0 12.15c0-1.5.75-2.91 1.95-3.75-.15-.45-.225-.93-.225-1.44C1.725 4.2 3.93 2 6.69 2c1.41 0 2.7.585 3.615 1.53l-.3 1.885z" />
    </svg>
  );
}

function KlaviyoIcon() {
  return (
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2L2 19h20L12 2zm0 4l7 11H5l7-11z" />
    </svg>
  );
}

function Cin7Icon() {
  return (
    <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}
