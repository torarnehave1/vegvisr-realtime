import React, { useState, useEffect } from 'react';
import { readStoredUser } from '../lib/auth';
import { Copy, Trash2, Edit2, Plus } from 'lucide-react';

interface Slug {
  id: string;
  slug: string;
  meetingId: string;
  ownerEmail: string;
  allowedEmails: string[];
  active: boolean;
  createdAt: string;
}

interface Room {
  id: string;
  kind?: string | null;
  title?: string | null;
}

interface SlugManagementProps {
  userRooms: Room[];
}

export const SlugManagement: React.FC<SlugManagementProps> = ({ userRooms }) => {
  const [slugs, setSlugs] = useState<Slug[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingSlug, setEditingSlug] = useState<Slug | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const stored = readStoredUser();

  const [formData, setFormData] = useState({
    slug: '',
    meetingId: '',
    allowedEmails: '',
  });

  // Fetch slugs on mount
  useEffect(() => {
    fetchSlugs();
  }, []);

  const fetchSlugs = async () => {
    if (!stored?.emailVerificationToken) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('https://api.vegvisr.org/realtime/slugs', {
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await res.json();
      if (data.success) {
        setSlugs(data.slugs || []);
      } else {
        setError(data.error || 'Failed to fetch slugs');
      }
    } catch (err) {
      setError('Failed to fetch slugs');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const validateSlug = (slug: string): string | null => {
    if (slug.length < 3 || slug.length > 50) {
      return 'Slug must be 3-50 characters';
    }
    if (!/^[a-z0-9\-]+$/.test(slug)) {
      return 'Only lowercase letters, numbers, and hyphens allowed';
    }
    if (/^-|-$/.test(slug) || /--/.test(slug)) {
      return 'Slug cannot start/end with hyphen or have consecutive hyphens';
    }
    if (slugs.some(s => s.slug === slug && s.id !== editingSlug?.id)) {
      return 'Slug already exists';
    }
    return null;
  };

  const handleCreateOrUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stored?.emailVerificationToken) return;

    const slugError = validateSlug(formData.slug);
    if (slugError) {
      setError(slugError);
      return;
    }

    const emails = formData.allowedEmails
      .split('\n')
      .map(e => e.trim())
      .filter(e => e.length > 0);

    if (emails.length === 0) {
      setError('At least one email is required');
      return;
    }

    try {
      const url = editingSlug
        ? `https://api.vegvisr.org/realtime/slugs/${editingSlug.id}/update`
        : 'https://api.vegvisr.org/realtime/slugs/create';

      const method = editingSlug ? 'POST' : 'POST';

      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Token': stored.emailVerificationToken,
        },
        body: JSON.stringify({
          slug: formData.slug,
          meetingId: formData.meetingId,
          allowedEmails: emails,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setFormData({ slug: '', meetingId: '', allowedEmails: '' });
        setShowCreateForm(false);
        setEditingSlug(null);
        setError(null);
        await fetchSlugs();
      } else {
        setError(data.error || 'Failed to save slug');
      }
    } catch (err) {
      setError('Failed to save slug');
      console.error(err);
    }
  };

  const handleDelete = async (slugId: string) => {
    if (!stored?.emailVerificationToken) return;
    if (!window.confirm('Are you sure?')) return;

    try {
      const res = await fetch(`https://api.vegvisr.org/realtime/slugs/${slugId}`, {
        method: 'DELETE',
        headers: { 'X-API-Token': stored.emailVerificationToken },
      });
      const data = await res.json();
      if (data.success) {
        await fetchSlugs();
      } else {
        setError(data.error || 'Failed to delete slug');
      }
    } catch (err) {
      setError('Failed to delete slug');
      console.error(err);
    }
  };

  const copyToClipboard = (slug: string) => {
    const url = `${window.location.origin}/${slug}`;
    navigator.clipboard.writeText(url);
    setCopied(slug);
    setTimeout(() => setCopied(null), 2000);
  };

  const getRoomLabel = (meetingId: string) => {
    const room = userRooms.find(r => r.id === meetingId);
    if (!room) return meetingId;
    if (room.kind === 'personal') return '🏠 My Room';
    if (room.kind === 'team') return '👥 Team Room';
    return room.title || meetingId;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Header + Create Button */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Custom Room Slugs</h2>
          <p className="text-slate-400 text-sm mt-1">
            Create memorable URLs for your meeting rooms
          </p>
        </div>
        <button
          onClick={() => {
            setEditingSlug(null);
            setFormData({ slug: '', meetingId: '', allowedEmails: '' });
            setShowCreateForm(!showCreateForm);
          }}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium flex items-center gap-2 transition"
        >
          <Plus size={18} />
          New Slug
        </button>
      </div>

      {/* Create/Edit Form */}
      {showCreateForm && (
        <form onSubmit={handleCreateOrUpdate} className="bg-slate-900 rounded-lg p-6 border border-slate-700 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Slug Name</label>
            <input
              type="text"
              value={formData.slug}
              onChange={(e) => setFormData({ ...formData, slug: e.target.value.toLowerCase() })}
              placeholder="slowyou, team-alpha, etc."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-slate-500 text-xs mt-1">Lowercase letters, numbers, hyphens only (3-50 chars)</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Room</label>
            <select
              value={formData.meetingId}
              onChange={(e) => setFormData({ ...formData, meetingId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select a room</option>
              {userRooms.map((room) => (
                <option key={room.id} value={room.id}>
                  {getRoomLabel(room.id)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">Allowed Emails (one per line)</label>
            <textarea
              value={formData.allowedEmails}
              onChange={(e) => setFormData({ ...formData, allowedEmails: e.target.value })}
              placeholder="user@example.com&#10;admin@example.com"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none h-24"
            />
          </div>

          <div className="flex gap-3">
            <button
              type="submit"
              className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition"
            >
              {editingSlug ? 'Update' : 'Create'} Slug
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(false);
                setEditingSlug(null);
                setFormData({ slug: '', meetingId: '', allowedEmails: '' });
              }}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Slugs List */}
      {slugs.length === 0 ? (
        <div className="text-center py-12 text-slate-400">
          No custom slugs yet. Create one to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {slugs.map((s) => (
            <div
              key={s.id}
              className="bg-slate-900 rounded-lg p-4 border border-slate-700 flex items-center justify-between hover:border-slate-600 transition"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-2">
                  <code className="text-blue-400 font-semibold">/{s.slug}</code>
                  <span className="text-slate-500 text-xs">→ {getRoomLabel(s.meetingId)}</span>
                  {!s.active && <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">Inactive</span>}
                </div>
                <p className="text-slate-400 text-xs">
                  {s.allowedEmails.length} approved user{s.allowedEmails.length !== 1 ? 's' : ''}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyToClipboard(s.slug)}
                  title="Copy URL"
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                >
                  <Copy size={16} />
                </button>
                {copied === s.slug && <span className="text-xs text-green-400">Copied!</span>}

                <button
                  onClick={() => {
                    setEditingSlug(s);
                    setFormData({
                      slug: s.slug,
                      meetingId: s.meetingId,
                      allowedEmails: s.allowedEmails.join('\n'),
                    });
                    setShowCreateForm(true);
                  }}
                  title="Edit"
                  className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                >
                  <Edit2 size={16} />
                </button>

                <button
                  onClick={() => handleDelete(s.id)}
                  title="Delete"
                  className="p-2 text-slate-400 hover:text-red-400 hover:bg-slate-800 rounded transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
