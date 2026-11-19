import { useState } from 'react';
import { Send, X } from 'lucide-react';
import type { Role } from '../shared/types';
import { apiFetch } from '../utils/api';

interface AiAssistantDrawerProps {
  role: Role;
  onClose: () => void;
}

interface ChatMessage {
  sender: 'user' | 'assistant';
  text: string;
  source?: string;
}

export function AiAssistantDrawer({ role, onClose }: AiAssistantDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      sender: 'assistant',
      text: `Ask about your ${role} workspace—for example urgent donations, NGO shortages, redistribution speed, or weekly waste reduction. Answers use only real, role-scoped records.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const quickPrompts = [
    'Which donation needs attention now?',
    'Which NGO has the biggest shortage?',
    'How can this donation be redistributed faster?',
    'What reduced waste this week?',
  ];

  const ask = async (q: string) => {
    const clean = q.trim();
    if (!clean || loading) return;
    setMessages((prev) => [...prev, { sender: 'user', text: clean }]);
    setInput('');
    setLoading(true);
    try {
      const res = await apiFetch<{ source: string; answer: string }>('/api/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({ question: clean }),
      });
      setMessages((prev) => [
        ...prev,
        { sender: 'assistant', text: res.answer, source: res.source },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { sender: 'assistant', text: (err as Error).message, source: 'error' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="FoodBridge AI Assistant"
      className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-slate-200 shadow-2xl flex flex-col"
    >
      <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">AI Operations Assistant</h2>
          <p className="text-xs text-slate-500">Scoped to {role} permissions · Grounded in live data</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close AI Assistant"
          className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="px-4 py-3 border-b border-slate-100 bg-slate-50 flex flex-wrap gap-1.5">
        {quickPrompts.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => ask(p)}
            className="px-2.5 py-1 text-[11px] font-medium text-emerald-900 bg-white border border-slate-200 rounded-md hover:border-emerald-600 cursor-pointer text-left"
          >
            {p}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded-xl text-xs leading-relaxed ${
              m.sender === 'user'
                ? 'bg-emerald-700 text-white ml-8'
                : 'bg-slate-100 text-slate-900 mr-6'
            }`}
          >
            <p>{m.text}</p>
            {m.source === 'fallback' && (
              <p className="text-[10px] text-amber-800 mt-1.5 font-medium">
                AI unavailable, showing rule-based result
              </p>
            )}
            {m.source === 'sample_demo' && (
              <p className="text-[10px] text-slate-500 mt-1.5 font-medium">Sample AI output</p>
            )}
          </div>
        ))}
        {loading && <p className="text-xs text-slate-500">Analyzing live workspace snapshot...</p>}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        className="p-4 border-t border-slate-200 flex items-center gap-2"
      >
        <label htmlFor="ai-assistant-input" className="sr-only">
          Ask FoodBridge AI Assistant
        </label>
        <input
          id="ai-assistant-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about donations, shortages, or impact..."
          className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg"
        />
        <button
          type="submit"
          disabled={loading}
          aria-label="Send question"
          className="p-2.5 text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
