import React, { useState } from 'react';
import { readStoredUser } from '../lib/auth';

interface AccessDeniedPageProps {
  slug: string;
  ownerEmail: string;
}

export const AccessDeniedPage: React.FC<AccessDeniedPageProps> = ({ slug, ownerEmail }) => {
  const [contactForm, setContactForm] = useState({ message: '' });
  const [submitted, setSubmitted] = useState(false);
  const stored = readStoredUser();
  const isLoggedIn = !!stored?.email;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.message.trim()) return;

    try {
      await fetch('https://api.vegvisr.org/realtime/slug-contact-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug,
          ownerEmail,
          visitorEmail: stored?.email || 'unknown',
          message: contactForm.message,
        }),
      });
      setSubmitted(true);
      setContactForm({ message: '' });
      setTimeout(() => setSubmitted(false), 4000);
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">
            Access Restricted
          </h1>
          <p className="text-slate-400">
            The room <span className="font-mono font-semibold text-blue-400">/{slug}</span> is not available to you.
          </p>
        </div>

        {/* Not logged in state */}
        {!isLoggedIn ? (
          <div className="bg-slate-900 rounded-lg p-6 mb-6 border border-slate-700">
            <p className="text-slate-300 mb-4">
              You need to be logged in to request access to this room.
            </p>
            <a
              href="/"
              className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium transition"
            >
              Back to Login
            </a>
          </div>
        ) : (
          <>
            {/* Contact form */}
            <form onSubmit={handleSubmit} className="bg-slate-900 rounded-lg p-6 border border-slate-700">
              <label className="block text-sm font-medium text-slate-300 mb-3">
                Send a message to the room owner
              </label>
              <textarea
                value={contactForm.message}
                onChange={(e) => setContactForm({ message: e.target.value })}
                placeholder="Hi, I'd like access to this room. Here's why..."
                className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-24 mb-3"
              />
              <button
                type="submit"
                disabled={!contactForm.message.trim()}
                className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded font-medium transition"
              >
                Send Request
              </button>

              {submitted && (
                <p className="text-green-400 text-sm mt-3">
                  Message sent to {ownerEmail}
                </p>
              )}
            </form>

            {/* Alternative: copy email */}
            <div className="mt-6 pt-6 border-t border-slate-700">
              <p className="text-slate-400 text-sm mb-3">
                Or contact the room owner directly:
              </p>
              <a
                href={`mailto:${ownerEmail}?subject=Access Request: /${slug}`}
                className="inline-block px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded font-medium transition border border-slate-600"
              >
                {ownerEmail}
              </a>
            </div>
          </>
        )}

        {/* Back link */}
        <div className="mt-8 text-center">
          <a
            href="/"
            className="text-blue-400 hover:text-blue-300 text-sm font-medium transition"
          >
            ← Back to Home
          </a>
        </div>
      </div>
    </div>
  );
};
