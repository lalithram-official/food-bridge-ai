import { useState } from 'react';
import { X } from 'lucide-react';
import type { Role } from '../shared/types';
import { apiFetch, setStoredToken } from '../utils/api';

interface AuthModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ onClose, onSuccess }: AuthModalProps) {
  const [tab, setTab] = useState<'demo' | 'login' | 'register'>('demo');
  const [email, setEmail] = useState('donor@foodbridge.demo');
  const [password, setPassword] = useState('demo123');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regRole, setRegRole] = useState<'donor' | 'ngo' | 'volunteer'>('donor');
  const [regOrg, setRegOrg] = useState('');
  const [regPhone, setRegPhone] = useState('+91-98450-99000');
  const [regArea, setRegArea] = useState('MG Road');
  const [regFssai, setRegFssai] = useState('');
  const [regVegOnly, setRegVegOnly] = useState(true);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDemoSwitch = async (role: Role, demoEmail?: string) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/demo-switch', {
        method: 'POST',
        body: JSON.stringify({ role, email: demoEmail }),
      });
      setStoredToken(res.token);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setStoredToken(res.token);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          name: regName,
          email: regEmail,
          password: regPassword,
          role: regRole,
          organizationName: regOrg,
          phone: regPhone,
          area: regArea,
          fssaiLicenseNumber: regFssai,
          vegOnly: regVegOnly,
        }),
      });
      setStoredToken(res.token);
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Workspace Access"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg overflow-hidden shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-lg font-bold text-slate-900">Access FoodBridge AI Workspace</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 text-slate-500 hover:text-slate-900 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 pt-4">
          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
            {(['demo', 'login', 'register'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => {
                  setTab(t);
                  setError('');
                }}
                className={`flex-1 py-2 text-xs font-semibold rounded-md transition-colors cursor-pointer ${
                  tab === t ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t === 'demo' ? 'Demo Quick Switch' : t === 'login' ? 'Sign In' : 'Register Account'}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-800">
              {error}
            </div>
          )}

          {tab === 'demo' && (
            <div className="space-y-3">
              <p className="text-xs text-slate-600">
                Demo Tool: Choose any seeded account below to test role-based dashboards and end-to-end flows immediately.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoSwitch('donor', 'donor@foodbridge.demo')}
                  className="p-3 text-left border border-slate-200 rounded-lg hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900">Donor (Restaurant)</p>
                  <p className="text-xs text-slate-500">Annapoorna Grand Kitchen</p>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoSwitch('ngo', 'ngo@foodbridge.demo')}
                  className="p-3 text-left border border-slate-200 rounded-lg hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900">NGO #1 (Veg Shelter)</p>
                  <p className="text-xs text-slate-500">Karuna Community Kitchen</p>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoSwitch('ngo', 'hope@foodbridge.demo')}
                  className="p-3 text-left border border-slate-200 rounded-lg hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900">NGO #2 (Urban Shelter)</p>
                  <p className="text-xs text-slate-500">Hope Urban Shelter Trust</p>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoSwitch('volunteer', 'volunteer@foodbridge.demo')}
                  className="p-3 text-left border border-slate-200 rounded-lg hover:border-emerald-600 hover:bg-emerald-50/40 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900">Volunteer Courier</p>
                  <p className="text-xs text-slate-500">Rohan Kulkarni (Cargo Scooter)</p>
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => handleDemoSwitch('admin', 'admin@foodbridge.demo')}
                  className="sm:col-span-2 p-3 text-left border border-slate-300 bg-slate-50 rounded-lg hover:border-slate-900 transition-colors cursor-pointer"
                >
                  <p className="text-sm font-semibold text-slate-900">Admin (Safety & Operations)</p>
                  <p className="text-xs text-slate-500">Approve safety reviews, verify NGOs, inspect anomalies</p>
                </button>
              </div>
            </div>
          )}

          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="login-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Password (demo accounts use demo123)
                </label>
                <input
                  id="login-pw"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          )}

          {tab === 'register' && (
            <form onSubmit={handleRegister} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-role" className="block text-xs font-medium text-slate-700 mb-1">
                    Role
                  </label>
                  <select
                    id="reg-role"
                    value={regRole}
                    onChange={(e) => setRegRole(e.target.value as 'donor' | 'ngo' | 'volunteer')}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  >
                    <option value="donor">Donor</option>
                    <option value="ngo">NGO / Community Kitchen</option>
                    <option value="volunteer">Volunteer / Driver</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
                    Contact Name
                  </label>
                  <input
                    id="reg-name"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Full name"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1">
                    Email
                  </label>
                  <input
                    id="reg-email"
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="name@org.org"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label htmlFor="reg-pw" className="block text-xs font-medium text-slate-700 mb-1">
                    Password
                  </label>
                  <input
                    id="reg-pw"
                    type="password"
                    required
                    value={regPassword}
                    onChange={(e) => setRegPassword(e.target.value)}
                    placeholder="Create password"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              </div>
              {regRole !== 'volunteer' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="reg-org" className="block text-xs font-medium text-slate-700 mb-1">
                      Organization Name
                    </label>
                    <input
                      id="reg-org"
                      required
                      value={regOrg}
                      onChange={(e) => setRegOrg(e.target.value)}
                      placeholder="Kitchen / NGO name"
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div>
                    <label htmlFor="reg-area" className="block text-xs font-medium text-slate-700 mb-1">
                      Area
                    </label>
                    <input
                      id="reg-area"
                      value={regArea}
                      onChange={(e) => setRegArea(e.target.value)}
                      className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                    />
                  </div>
                </div>
              )}
              {regRole === 'donor' && (
                <div>
                  <label htmlFor="reg-fssai" className="block text-xs font-medium text-slate-700 mb-1">
                    FSSAI License Number (field only, optional)
                  </label>
                  <input
                    id="reg-fssai"
                    value={regFssai}
                    onChange={(e) => setRegFssai(e.target.value)}
                    placeholder="14-digit FSSAI reference"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
                  />
                </div>
              )}
              {regRole === 'ngo' && (
                <label className="flex items-center gap-2 text-xs text-slate-700">
                  <input
                    type="checkbox"
                    checked={regVegOnly}
                    onChange={(e) => setRegVegOnly(e.target.checked)}
                  />
                  Vegetarian-only kitchen (new NGOs start as Pending until Admin verifies)
                </label>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
              >
                {loading ? 'Creating account...' : 'Create Account & Enter'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
