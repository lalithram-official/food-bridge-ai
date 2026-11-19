import { useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { LandingPage } from './components/LandingPage';
import { VerifyCertificatePage } from './components/VerifyCertificatePage';
import { WorkspaceShell } from './components/WorkspaceShell';
import type { Role } from './shared/types';
import { apiFetch, getStoredToken, setStoredToken } from './utils/api';

export default function App() {
  const [view, setView] = useState<'landing' | 'workspace' | 'verify'>('landing');
  const [verifyId, setVerifyId] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const certParam = params.get('verify');
    const autostart = params.get('autostart');
    if (certParam) {
      setVerifyId(certParam);
      setView('verify');
      return;
    }

    const token = getStoredToken();
    if (token) {
      apiFetch<{ user: unknown | null }>('/api/auth/me')
        .then((res) => {
          if (res.user) setView('workspace');
          else setStoredToken('');
        })
        .catch(() => setStoredToken(''));
    } else if (autostart === '1') {
      apiFetch<{ token: string }>('/api/auth/demo-switch', {
        method: 'POST',
        body: JSON.stringify({ role: 'donor', email: 'donor@foodbridge.demo' }),
      })
        .then((res) => {
          setStoredToken(res.token);
          setView('workspace');
        })
        .catch(() => {});
    }
  }, []);

  const handleOpenWorkspace = async (initialRole?: Role) => {
    if (initialRole) {
      try {
        const res = await apiFetch<{ token: string }>('/api/auth/demo-switch', {
          method: 'POST',
          body: JSON.stringify({ role: initialRole }),
        });
        setStoredToken(res.token);
        setView('workspace');
        return;
      } catch {
        // fall through to auth modal
      }
    }
    setShowAuthModal(true);
  };

  if (view === 'verify') {
    return (
      <VerifyCertificatePage
        initialCertId={verifyId}
        onBack={() => setView(getStoredToken() ? 'workspace' : 'landing')}
      />
    );
  }

  if (view === 'workspace') {
    return (
      <WorkspaceShell
        onExitToLanding={() => {
          setStoredToken('');
          setView('landing');
        }}
        onOpenVerify={(certId) => {
          setVerifyId(certId || '');
          setView('verify');
        }}
      />
    );
  }

  return (
    <>
      <LandingPage
        onOpenWorkspace={handleOpenWorkspace}
        onOpenLogin={() => setShowAuthModal(true)}
        onOpenVerify={() => {
          setVerifyId('CERT-202601');
          setView('verify');
        }}
      />
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            setView('workspace');
          }}
        />
      )}
    </>
  );
}
