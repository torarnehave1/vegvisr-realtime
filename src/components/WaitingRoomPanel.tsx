import React, { useState, useEffect } from 'react';

export function WaitingRoomPanel({ meeting }: { meeting: any }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<any[]>([]);

  useEffect(() => {
    if (!meeting?.participants?.waitlisted) return;
    const refresh = () => {
      setList(meeting.participants.waitlisted.toArray());
    };
    refresh();
    meeting.participants.waitlisted.on('participantJoined', refresh);
    meeting.participants.waitlisted.on('participantLeft', refresh);
    return () => {
      meeting.participants.waitlisted.removeListener('participantJoined', refresh);
      meeting.participants.waitlisted.removeListener('participantLeft', refresh);
    };
  }, [meeting]);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 1000, padding: '8px 16px', background: '#374151', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
      >
        Waiting Room ({list.length})
      </button>

      {open && (
        <div style={{ position: 'fixed', bottom: 130, right: 20, zIndex: 1000, width: 280, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'white', fontWeight: 600 }}>Waiting Room</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setList(meeting.participants.waitlisted.toArray())} style={{ background: '#1d4ed8', border: 'none', color: 'white', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          {list.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No one waiting</p>}
          {list.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, color: '#e2e8f0', fontSize: 13 }}>{p.name || 'Guest'}</span>
              <button onClick={() => meeting.participants.acceptWaitingRoomRequest(p.id)} style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>Accept</button>
              <button onClick={() => meeting.participants.rejectWaitingRoomRequest(p.id)} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>Deny</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
