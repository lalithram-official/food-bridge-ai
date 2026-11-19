import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, CheckCircle2, Download, Search, ShieldAlert } from 'lucide-react';
import QRCode from 'qrcode';
import type { Certificate } from '../shared/types';
import { apiFetch, downloadCertificateJson, downloadCertificatePdf } from '../utils/api';

interface VerifyCertificatePageProps {
  initialCertId?: string;
  onBack?: () => void;
}

export function VerifyCertificatePage({ initialCertId = '', onBack }: VerifyCertificatePageProps) {
  const [certId, setCertId] = useState(initialCertId || 'CERT-202601');
  const [status, setStatus] = useState<'Idle' | 'Valid' | 'Tampered' | 'Not Found'>('Idle');
  const [certificate, setCertificate] = useState<Certificate | null>(null);
  const [qrImageUrl, setQrImageUrl] = useState('');
  const [tamperStatus, setTamperStatus] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const runVerify = async (targetId: string) => {
    if (!targetId.trim()) return;
    setLoading(true);
    setTamperStatus('');
    try {
      const res = await apiFetch<{ status: 'Valid' | 'Tampered' | 'Not Found'; certificate: Certificate | null }>(
        `/api/certificates/${encodeURIComponent(targetId.trim())}/verify`
      );
      setStatus(res.status);
      setCertificate(res.certificate);
      if (res.certificate) {
        const url = `${window.location.origin}/?verify=${encodeURIComponent(res.certificate.id)}`;
        const dataUrl = await QRCode.toDataURL(url, { width: 128, margin: 1 });
        setQrImageUrl(dataUrl);
      } else {
        setQrImageUrl('');
      }
    } catch {
      setStatus('Not Found');
      setCertificate(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (certId) runVerify(certId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSimulateTamper = async () => {
    if (!certificate) return;
    const alteredPayload = {
      ...certificate.payload,
      portions: certificate.payload.portions + 50,
    };
    const res = await apiFetch<{ status: string }>('/api/certificates/verify-payload', {
      method: 'POST',
      body: JSON.stringify({
        payload: alteredPayload,
        signature: certificate.signature,
      }),
    });
    setTamperStatus(
      `Modified portions from ${certificate.payload.portions} to ${alteredPayload.portions} -> Verification returned: ${res.status}`
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAF9] py-10 px-6">
      <div className="max-w-3xl mx-auto">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900 mb-6 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
        )}

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8">
          <p className="text-xs font-medium text-emerald-800 mb-2">
            Public Verification · No Login Required · HMAC-SHA256
          </p>
          <h1 className="text-2xl font-bold font-display text-slate-900 mb-2">
            Verify Donation Certificate
          </h1>
          <p className="text-sm text-slate-600 mb-6">
            Enter a Certificate ID (e.g. CERT-202601) or scan its QR code to verify payload integrity
            and inspect the Food Safety Passport handover record.
          </p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              runVerify(certId);
            }}
            className="flex flex-col sm:flex-row gap-3 mb-6"
          >
            <label htmlFor="verify-cert-input" className="sr-only">
              Certificate ID
            </label>
            <input
              id="verify-cert-input"
              type="text"
              value={certId}
              onChange={(e) => setCertId(e.target.value)}
              placeholder="Enter Certificate ID (e.g. CERT-202601)"
              className="flex-1 px-4 py-2.5 text-sm font-mono border border-slate-300 rounded-lg focus:outline-none focus:border-emerald-700"
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer whitespace-nowrap"
            >
              <Search className="w-4 h-4" />
              {loading ? 'Checking...' : 'Verify Certificate'}
            </button>
          </form>

          {status === 'Valid' && certificate && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="w-6 h-6 text-emerald-700 shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-emerald-900">
                      Valid Certificate · Signature Verified ({certificate.algorithm})
                    </p>
                    <p className="text-xs text-emerald-800">
                      Payload matches server HMAC-SHA256 signature with zero alterations.
                    </p>
                  </div>
                </div>
                <span className="text-xs font-mono font-semibold text-emerald-900">
                  {certificate.id}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 items-start">
                <div className="sm:col-span-2 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Donor Organization</p>
                    <p className="font-semibold text-slate-900">{certificate.payload.donorName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Recipient NGO</p>
                    <p className="font-semibold text-slate-900">{certificate.payload.ngoName}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Surplus Food</p>
                    <p className="font-semibold text-slate-900">{certificate.payload.title}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Quantity</p>
                    <p className="font-semibold font-mono tabular-nums text-slate-900">
                      {certificate.payload.portions} meals · {certificate.payload.quantityKg} kg
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Handover Confirmed</p>
                    <p className="font-medium text-slate-800">
                      {new Date(certificate.payload.handoverAt).toLocaleString()} ({certificate.payload.handoverMethod})
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Safety Passport Summary</p>
                    <p className="font-medium text-slate-800">{certificate.payload.safetySummary}</p>
                  </div>
                </div>

                {qrImageUrl && (
                  <div className="flex flex-col items-center p-3 border border-slate-200 rounded-lg bg-slate-50">
                    <img src={qrImageUrl} alt="Certificate QR Code" className="w-28 h-28" />
                    <span className="text-[11px] text-slate-500 mt-1">Verification QR</span>
                  </div>
                )}
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                <p className="text-xs font-medium text-slate-600 mb-1">HMAC-SHA256 Digest</p>
                <p className="text-xs font-mono text-slate-800 break-all">{certificate.signature}</p>
              </div>

              {tamperStatus && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-xs font-semibold text-red-800">
                  <ShieldAlert className="w-4 h-4 shrink-0" />
                  <span>{tamperStatus}</span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => downloadCertificatePdf(certificate)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download PDF
                </button>
                <button
                  type="button"
                  onClick={() => downloadCertificateJson(certificate)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Signed JSON
                </button>
                <button
                  type="button"
                  onClick={handleSimulateTamper}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-300 rounded-lg hover:bg-amber-100 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Test Tamper Detection
                </button>
              </div>
            </div>
          )}

          {status === 'Tampered' && (
            <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-red-700 shrink-0" />
              <div>
                <p className="text-sm font-bold text-red-900">Tampered Certificate Detected</p>
                <p className="text-xs text-red-800">
                  The payload does not match the cryptographic signature.
                </p>
              </div>
            </div>
          )}

          {status === 'Not Found' && (
            <div className="p-4 rounded-lg bg-slate-100 border border-slate-200 text-sm text-slate-700">
              No certificate found for ID "{certId}". Try <span className="font-mono">CERT-202601</span> or complete an active donation handover first.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
