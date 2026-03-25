import React, { useState, useEffect, useReducer, createContext, useContext } from 'react';
import {
  RealtimeKitProvider,
  useRealtimeKitClient,
  useRealtimeKitMeeting,
  useRealtimeKitSelector,
} from '@cloudflare/realtimekit-react';
import {
  RtkCameraToggle,
  RtkChatToggle,
  RtkDialogManager,
  RtkEndedScreen,
  RtkGrid,
  RtkLeaveButton,
  RtkLogo,
  RtkMeetingTitle,
  RtkMicToggle,
  RtkParticipantsAudio,
  RtkScreenShareToggle,
  RtkSetupScreen,
  RtkSidebar,
  RtkSpinner,
  RtkUiProvider,
  defaultConfig,
  provideRtkDesignSystem,
} from '@cloudflare/realtimekit-react-ui';
import { AuthBar, EcosystemNav } from 'vegvisr-ui-kit';
import { readStoredUser, type AuthUser } from './lib/auth';
import { Login } from './components/Login';

const MAGIC_BASE = 'https://cookie.vegvisr.org';
const DASHBOARD_BASE = 'https://dashboard.vegvisr.org';

const AuthContext = createContext<AuthUser | null>(null);

// ─── Meeting UI ──────────────────────────────────────────────────────────────

const config = { ...defaultConfig };
if (config.root) {
  config.root['rtk-participant-tile'] = (
    config.root['rtk-participant-tile'] as any
  ).children;
}

function Meeting() {
  const { meeting } = useRealtimeKitMeeting();
  const roomJoined = useRealtimeKitSelector((m) => m.self.roomJoined);
  const roomState = useRealtimeKitSelector((m) => m.self.roomState);

  const [states, updateStates] = useReducer(
    (state: any, payload: any) => ({ ...state, ...payload }),
    { meeting: 'joined', activeSidebar: false },
  );

  if (!meeting) return <RtkSpinner />;
  if (roomState === 'ended' || roomState === 'left') return <RtkEndedScreen />;
  if (!roomJoined) return <RtkSetupScreen meeting={meeting} />;

  return (
    <div
      className="flex flex-col w-full h-full"
      ref={(el) => {
        el?.addEventListener('rtkStateUpdate', (e: any) => updateStates(e.detail));
      }}
    >
      <header className="flex items-center gap-3 h-12 border-b border-slate-700 w-full px-2 text-sm text-slate-200">
        <RtkLogo meeting={meeting} />
        <RtkMeetingTitle meeting={meeting} />
      </header>
      <main className="flex flex-1 p-2 min-h-0">
        <RtkGrid meeting={meeting} config={config} />
        {states.activeSidebar && <RtkSidebar meeting={meeting} states={states} />}
      </main>
      <footer className="p-2 flex items-center w-full border-t border-slate-700">
        <div className="flex flex-1">
          <RtkLeaveButton />
        </div>
        <div className="flex gap-2 justify-center flex-1">
          <RtkMicToggle meeting={meeting} />
          <RtkCameraToggle meeting={meeting} />
          <RtkScreenShareToggle meeting={meeting} />
          <RtkChatToggle meeting={meeting} />
        </div>
        <div className="flex flex-1" />
      </footer>
    </div>
  );
}

function RealtimeMeeting() {
  const [meeting, initMeeting] = useRealtimeKitClient();

  useEffect(() => {
    const searchParams = new URL(window.location.href).searchParams;
    const authToken = searchParams.get('authToken');

    if (!authToken) return;

    provideRtkDesignSystem(document.body, { theme: 'dark' });

    initMeeting({
      authToken,
      defaults: { audio: false, video: false },
    });
  }, []);

  return (
    <RealtimeKitProvider value={meeting}>
      <RtkUiProvider meeting={meeting} showSetupScreen>
        <Meeting />
        <RtkDialogManager />
        <RtkParticipantsAudio />
      </RtkUiProvider>
    </RealtimeKitProvider>
  );
}

// ─── Auth gate ───────────────────────────────────────────────────────────────

function AuthGate({ children }: { children: React.ReactNode }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authStatus, setAuthStatus] = useState<'checking' | 'authed' | 'anonymous'>('checking');

  const setAuthCookie = (token: string) => {
    if (!token) return;
    const isVegvisr = window.location.hostname.endsWith('vegvisr.org');
    const domain = isVegvisr ? '; Domain=.vegvisr.org' : '';
    const maxAge = 60 * 60 * 24 * 30;
    document.cookie = `vegvisr_token=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; SameSite=Lax; Secure${domain}`;
  };

  const persistUser = (user: {
    email: string;
    role: string;
    user_id: string | null;
    emailVerificationToken: string | null;
    oauth_id?: string | null;
  }) => {
    const payload = {
      email: user.email,
      role: user.role,
      user_id: user.user_id,
      oauth_id: user.oauth_id || user.user_id || null,
      emailVerificationToken: user.emailVerificationToken,
    };
    localStorage.setItem('user', JSON.stringify(payload));
    if (user.emailVerificationToken) setAuthCookie(user.emailVerificationToken);
    sessionStorage.setItem('email_session_verified', '1');
    setAuthUser({
      userId: payload.user_id || payload.oauth_id || '',
      email: payload.email,
      role: payload.role || null,
    });
  };

  const fetchUserContext = async (targetEmail: string) => {
    const roleRes = await fetch(`${DASHBOARD_BASE}/get-role?email=${encodeURIComponent(targetEmail)}`);
    if (!roleRes.ok) throw new Error(`User role unavailable (status: ${roleRes.status})`);
    const roleData = await roleRes.json();
    if (!roleData?.role) throw new Error('Unable to retrieve user role.');
    const userDataRes = await fetch(`${DASHBOARD_BASE}/userdata?email=${encodeURIComponent(targetEmail)}`);
    if (!userDataRes.ok) throw new Error(`Unable to fetch user data (status: ${userDataRes.status})`);
    const userData = await userDataRes.json();
    return {
      email: targetEmail,
      role: roleData.role,
      user_id: userData.user_id,
      emailVerificationToken: userData.emailVerificationToken,
      oauth_id: userData.oauth_id,
    };
  };

  const verifyMagicToken = async (token: string) => {
    const res = await fetch(`${MAGIC_BASE}/login/magic/verify?token=${encodeURIComponent(token)}`);
    const data = await res.json();
    if (!res.ok || !data.success || !data.email) throw new Error(data.error || 'Invalid or expired magic link.');
    try {
      const userContext = await fetchUserContext(data.email);
      persistUser(userContext);
    } catch {
      persistUser({ email: data.email, role: 'user', user_id: data.email, emailVerificationToken: null });
    }
  };

  const clearAuthCookie = () => {
    const base = 'vegvisr_token=; Path=/; Max-Age=0; SameSite=Lax; Secure';
    document.cookie = base;
    if (window.location.hostname.endsWith('vegvisr.org')) {
      document.cookie = `${base}; Domain=.vegvisr.org`;
    }
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem('user');
      sessionStorage.removeItem('email_session_verified');
    } catch { /* ignore */ }
    clearAuthCookie();
    setAuthUser(null);
    setAuthStatus('anonymous');
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    const magic = url.searchParams.get('magic');
    if (!magic) return;
    setAuthStatus('checking');
    verifyMagicToken(magic)
      .then(() => {
        url.searchParams.delete('magic');
        window.history.replaceState({}, '', url.toString());
        setAuthStatus('authed');
      })
      .catch(() => setAuthStatus('anonymous'));
  }, []);

  useEffect(() => {
    let isMounted = true;
    const stored = readStoredUser();
    if (stored && isMounted) {
      setAuthUser(stored);
      setAuthStatus('authed');
    } else if (isMounted) {
      setAuthStatus('anonymous');
    }
    return () => { isMounted = false; };
  }, []);

  if (authStatus === 'authed') {
    return (
      <AuthContext.Provider value={authUser}>
        <div className="flex flex-col h-screen bg-slate-950 text-white">
          <div className="flex-shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2 flex items-center justify-between">
            <EcosystemNav />
            <AuthBar
              userEmail={authUser?.email}
              badgeLabel="Vegvisr"
              signInLabel="Sign in"
              logoutLabel="Log out"
              onLogout={handleLogout}
            />
          </div>
          <div className="flex-1 min-h-0">
            {children}
          </div>
        </div>
      </AuthContext.Provider>
    );
  }

  if (authStatus === 'anonymous') {
    return <Login />;
  }

  // checking state — spinner
  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────

export function useAuth() {
  return useContext(AuthContext);
}

export default function App() {
  return (
    <AuthGate>
      <RealtimeMeeting />
    </AuthGate>
  );
}
