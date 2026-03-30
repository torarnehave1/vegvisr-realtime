import React, { useState, useEffect } from 'react';

interface WaitingRoomPanelProps {
  meeting: any;
}

export function WaitingRoomPanel({ meeting }: WaitingRoomPanelProps) {
  const [participants, setParticipants] = useState<any[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!meeting?.participants?.waitlisted) return;

    const refresh = () => {
      const list: any[] = [];
      meeting.participants.waitlisted.toArray().forEach((p: any) => list.push(p));
      setParticipants(list);
    };

    const onKnock = (p: any) => {
      refresh();
      setIsOpen(true);
    };

    refresh();
    meeting.participants.waitlisted.on('participantJoined', onKnock);
    meeting.participants.waitlisted.on('participantLeft', refresh);

    return () => {
      meeting.participants.waitlisted.removeListener('participantJoined', onKnock);
      meeting.participants.waitlisted.removeListener('participantLeft', refresh);
    };
  }, [meeting]);

  const accept = (id: string) => meeting?.participants?.acceptWaitingRoomRequest(id);
  const reject = (id: string) => meeting?.participants?.rejectWaitingRoomRequest(id);
  const acceptAll = () => {
    const ids = participants.map((p) => p.id);
    if (ids.length > 0) meeting?.participants?.acceptAllWaitingRoomRequest(ids);
  };

  return (
    <>
      {/* Toggle button — always visible to host */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          position: 'fixed',
          bottom: '80px',
          right: '20px',
          zIndex: 1000,
          background: participants.length > 0 ? '#d97706' : '#374151',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          padding: '10px 16px',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          boxShadow: participants.length > 0 ? '0 0 0 3px rgba(217,119,6,0.4)' : 'none',
          animation: participants.length > 0 ? 'pulse 1.5s infinite' : 'none',
        }}
      >
        🚪 Waiting Room {participants.length > 0 ? `(${participants.length})` : ''}
      </button>

      {/* Panel */}
      {isOpen && (
        <div style={{
          position: 'fixed',
          bottom: '140px',
          right: '20px',
          zIndex: 1000,
          width: '300px',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '12px',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 16px',
            borderBottom: '1px solid #334155',
            background: '#0f172a',
          }}>
            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '14px' }}>
              Waiting Room ({participants.length})
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {participants.length > 0 && (
                <button
                  onClick={acceptAll}
                  style={{
                    background: '#059669',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    padding: '4px 10px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Accept All
                </button>
              )}
              <button
                onClick={() => setIsOpen(false)}
                style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px' }}
              >
                ✕
              </button>
            </div>
          </div>

          {/* List */}
          <div style={{ padding: '8px', maxHeight: '300px', overflowY: 'auto' }}>
            {participants.length === 0 ? (
              <p style={{ color: '#64748b', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>
                No one waiting
              </p>
            ) : (
              participants.map((p) => (
                <div key={p.id} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px',
                  borderRadius: '8px',
                  marginBottom: '4px',
                  background: '#0f172a',
                }}>
                  <div style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '50%',
                    background: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    fontSize: '14px',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}>
                    {(p.name || '?')[0].toUpperCase()}
                  </div>
                  <span style={{ flex: 1, color: '#e2e8f0', fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.name || p.customParticipantId || 'Guest'}
                  </span>
                  <button
                    onClick={() => accept(p.id)}
                    style={{
                      background: '#059669',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title="Let in"
                  >
                    ✓
                  </button>
                  <button
                    onClick={() => reject(p.id)}
                    style={{
                      background: '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      padding: '4px 8px',
                      fontSize: '12px',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                    title="Deny"
                  >
                    ✕
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(217,119,6,0.4); }
          50% { box-shadow: 0 0 0 6px rgba(217,119,6,0.1); }
        }
      `}</style>
    </>
  );
}
