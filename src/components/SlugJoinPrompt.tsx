import React, { useState } from 'react';

interface SlugJoinPromptProps {
  slug: string;
  onJoin: (email: string) => void;
  loading: boolean;
  error?: string | null;
}

export const SlugJoinPrompt: React.FC<SlugJoinPromptProps> = ({ slug, onJoin, loading, error }) => {
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) return;
    onJoin(trimmed);
  };

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-white mb-2">Join meeting</h1>
          <p className="text-slate-400">
            Room <span className="font-mono font-semibold text-blue-400">/{slug}</span>
          </p>
        </div>

        <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg p-6 border border-slate-700">
          <label htmlFor="email" className="block text-sm font-medium text-slate-300 mb-3">
            Enter your email to join
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            disabled={loading}
            className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-3"
          />
          <button
            type="submit"
            disabled={!isValidEmail || loading}
            className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded font-medium transition"
          >
            {loading ? 'Joining…' : 'Join meeting'}
          </button>
          {error && (
            <p className="text-red-400 text-sm mt-3">{error}</p>
          )}
        </form>

        <div className="mt-8 text-center">
          <a href="/" className="text-blue-400 hover:text-blue-300 text-sm font-medium transition">
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
};
