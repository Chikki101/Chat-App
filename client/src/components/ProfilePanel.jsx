import { useEffect, useState } from 'react';
import { api } from '../api.js';

export default function ProfilePanel({ userId, token, blockedByMe, onClose, onBlock, onUnblock }) {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({ email: '', phone: '', bio: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    api.profile(userId, token)
      .then(({ profile: nextProfile }) => {
        if (cancelled) return;
        setProfile(nextProfile);
        setForm({
          email: nextProfile.email || '',
          phone: nextProfile.phone || '',
          bio: nextProfile.bio || '',
        });
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, userId]);

  const saveProfile = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const { profile: updated } = await api.updateProfile(form, token);
      setProfile(updated);
      setNotice('Profile saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleBlock = async () => {
    setError('');
    try {
      if (blockedByMe) {
        if (await onUnblock(userId) === false) return;
        setNotice('User unblocked. Friendship is not restored automatically.');
      } else {
        if (await onBlock(userId) === false) return;
        setNotice('User blocked.');
      }
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="profile-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="profile-panel" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <button className="profile-close" onClick={onClose} aria-label="Close profile">×</button>
        {loading ? (
          <p>Loading profile…</p>
        ) : error && !profile ? (
          <p className="profile-error" role="alert">{error}</p>
        ) : profile ? (
          <>
            <div className="profile-heading">
              <div className="avatar profile-avatar" style={{ background: profile.avatarColor }}>
                {profile.username[0].toUpperCase()}
              </div>
              <div>
                <h2 id="profile-title">{profile.username}</h2>
                <code>{profile.id}</code>
              </div>
            </div>
            <p className="profile-since">
              Member since {new Date(profile.createdAt).toLocaleDateString()}
            </p>
            {profile.isSelf ? (
              <form className="profile-form" onSubmit={saveProfile}>
                <label className="field">
                  <span>Email (friends only)</span>
                  <input
                    type="email"
                    maxLength={254}
                    value={form.email}
                    onChange={(event) => setForm({ ...form, email: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Phone (friends only)</span>
                  <input
                    type="tel"
                    maxLength={32}
                    value={form.phone}
                    onChange={(event) => setForm({ ...form, phone: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>Bio (friends only)</span>
                  <textarea
                    maxLength={500}
                    rows={4}
                    value={form.bio}
                    onChange={(event) => setForm({ ...form, bio: event.target.value })}
                  />
                </label>
                <button className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save profile'}
                </button>
              </form>
            ) : profile.canViewPrivate ? (
              <dl className="profile-details">
                <dt>Email</dt><dd>{profile.email || 'Not provided'}</dd>
                <dt>Phone</dt><dd>{profile.phone || 'Not provided'}</dd>
                <dt>Bio</dt><dd>{profile.bio || 'Not provided'}</dd>
              </dl>
            ) : (
              <p className="profile-private-note">Email, phone, and bio are visible only to accepted friends.</p>
            )}
            {!profile.isSelf && (
              <button className="profile-block" onClick={handleBlock}>
                {blockedByMe ? 'Unblock user' : 'Block user'}
              </button>
            )}
            {notice && <p className="profile-notice" role="status">{notice}</p>}
            {error && <p className="profile-error" role="alert">{error}</p>}
          </>
        ) : null}
      </section>
    </div>
  );
}
