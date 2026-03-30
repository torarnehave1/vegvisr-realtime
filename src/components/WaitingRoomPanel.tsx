import React, { useState, useEffect } from 'react';

export function WaitingRoomPanel({ meeting }: { meeting: any }) {
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<any[]>([]);

  useEffect(() => {
    console.log('[WaitingRoom] WaitingRoomPanel mounted. meeting.participants.waitlisted:', meeting?.participants?.waitlisted);
    if (!meeting?.participants?.waitlisted) {
      console.warn('[WaitingRoom] waitlisted is not available on meeting object');
      return;
    }
    const refresh = () => {
      const arr = meeting.participants.waitlisted.toArray();
      console.log('[WaitingRoom] waitlist updated. count:', arr.length, '| participants:', arr.map((p: any) => ({ id: p.id, name: p.name })));
      setList(arr);
    };
    refresh();
    meeting.participants.waitlisted.on('participantJoined', (p: any) => {
      console.log('[WaitingRoom] EVENT participantJoined waiting room:', { id: p?.id, name: p?.name });
      refresh();
    });
    meeting.participants.waitlisted.on('participantLeft', (p: any) => {
      console.log('[WaitingRoom] EVENT participantLeft waiting room:', { id: p?.id, name: p?.name });
      refresh();
    });
    return () => {
      meeting.participants.waitlisted.removeListener('participantJoined', refresh);
      meeting.participants.waitlisted.removeListener('participantLeft', refresh);
    };
  }, [meeting]);

  return (
    <>
      <button
        onClick={() => setOpen(!open)}
        style={{ position: 'fixed', bottom: 80, right: 20, zIndex: 2147483647, pointerEvents: 'auto', padding: '8px 16px', background: '#374151', color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
      >
        Waiting Room ({list.length})
      </button>

      {open && (
        <div style={{ position: 'fixed', bottom: 130, right: 20, zIndex: 2147483647, pointerEvents: 'auto', width: 280, background: '#1e293b', border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ color: 'white', fontWeight: 600 }}>Waiting Room</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { const arr = meeting.participants.waitlisted.toArray(); console.log('[WaitingRoom] Manual refresh. count:', arr.length, arr.map((p: any) => ({ id: p.id, name: p.name }))); setList(arr); }} style={{ background: '#1d4ed8', border: 'none', color: 'white', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', fontSize: 12 }}>Refresh</button>
              <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer' }}>✕</button>
            </div>
          </div>
          {list.length === 0 && <p style={{ color: '#64748b', fontSize: 13 }}>No one waiting</p>}
          {list.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ flex: 1, color: '#e2e8f0', fontSize: 13 }}>{p.name || 'Guest'}</span>
              <button onClick={() => { console.log('[WaitingRoom] ACCEPT clicked for:', { id: p.id, name: p.name }); meeting.participants.acceptWaitingRoomRequest(p.id); }} style={{ background: '#059669', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>Accept</button>
              <button onClick={() => { console.log('[WaitingRoom] DENY clicked for:', { id: p.id, name: p.name }); meeting.participants.rejectWaitingRoomRequest(p.id); }} style={{ background: '#dc2626', color: 'white', border: 'none', borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 12 }}>Deny</button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
