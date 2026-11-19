import { useState } from 'react';
import { Award, BellRing, Copy, Download, Plus, Repeat, Search, Sparkles } from 'lucide-react';
import type {
  DietaryType,
  Donation,
  DonorProfile,
  FoodCategory,
  StorageMethod,
} from '../shared/types';
import {
  apiFetch,
  downloadCertificateJson,
  downloadCertificatePdf,
  formatTimeRemaining,
  type WorkspaceState,
} from '../utils/api';
import type { Language } from '../i18n/translations';
import { tr, translateStatus } from '../i18n/translations';

interface DonorDashboardProps {
  state: WorkspaceState;
  activeTab: string;
  lang: Language;
  lowDataMode: boolean;
  insights: { source: string; insights: string[] } | null;
  onRefresh: () => Promise<void>;
  onSelectDonation: (d: Donation) => void;
  onOpenCertificate: (certId: string) => void;
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

const CATEGORIES: FoodCategory[] = [
  'Cooked Veg Curry / Meals',
  'Cooked Rice / Dal',
  'Cooked Non-Veg',
  'Bakery & Bread',
  'Dairy & Sweets',
  'Raw Produce',
  'Packaged / Dry Goods',
];

const ALLERGENS = ['None declared', 'Dairy', 'Gluten', 'Peanuts', 'Tree Nuts', 'Soy'];

export function DonorDashboard({
  state,
  activeTab,
  lang,
  lowDataMode,
  insights,
  onRefresh,
  onSelectDonation,
  onOpenCertificate,
  onToast,
}: DonorDashboardProps) {
  const donorProfile = state.profile as DonorProfile | null;
  const nowIsoLocal = (offsetMins = 0) => {
    const dt = new Date(Date.now() + offsetMins * 60000);
    dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
    return dt.toISOString().slice(0, 16);
  };

  const [title, setTitle] = useState('Veg Pulao, Dal Tadka & Sabzi Meals');
  const [category, setCategory] = useState<FoodCategory>('Cooked Veg Curry / Meals');
  const [dietaryType, setDietaryType] = useState<DietaryType>('Veg');
  const [allergens, setAllergens] = useState<string[]>(['Dairy']);
  const [portions, setPortions] = useState(25);
  const [quantityKg, setQuantityKg] = useState(10);
  const [preparedAt, setPreparedAt] = useState(nowIsoLocal(-20));
  const [readyBy, setReadyBy] = useState(nowIsoLocal(5));
  const [pickupWindowEnd, setPickupWindowEnd] = useState(nowIsoLocal(150));
  const [storageMethod, setStorageMethod] = useState<StorageMethod>('Hot Held');
  const [temperatureC, setTemperatureC] = useState('68');
  const [packaging, setPackaging] = useState('Sealed stainless steel trays');
  const [photos, setPhotos] = useState<string[]>([
    '/src/assets/images/sample_veg_meals_1795069683150.jpg',
  ]);
  const [isBulkEvent, setIsBulkEvent] = useState(false);
  const [eventName, setEventName] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [submitting, setSubmitting] = useState(false);

  // Recurring template state
  const [tmplTitle, setTmplTitle] = useState('Nightly Buffet Veg Surplus');
  const [tmplSchedule, setTmplSchedule] = useState('Daily at 21:00');

  const myDonations = state.donations;
  const completed = myDonations.filter((d) => d.status === 'Completed');
  const totalMeals = completed.reduce((s, d) => s + d.portions, 0);
  const totalKg = Math.round(completed.reduce((s, d) => s + d.quantityKg, 0) * 10) / 10;
  const estCo2 = Math.round(totalKg * state.settings.assumptions.co2eKgPerKgFood * 10) / 10;

  const badges = [
    { name: 'First Rescue', unlocked: completed.length >= 1, req: '1+ completed donation' },
    { name: '10 Rescues', unlocked: completed.length >= 10, req: '10+ completed donations' },
    { name: '100 Meals', unlocked: totalMeals >= 100, req: '100+ meals redistributed' },
    { name: '1 Tonne Club', unlocked: totalKg >= 1000, req: '1,000+ kg rescued' },
  ];

  const toggleAllergen = (item: string) => {
    if (item === 'None declared') {
      setAllergens(['None declared']);
      return;
    }
    setAllergens((prev) => {
      const cleaned = prev.filter((x) => x !== 'None declared');
      if (cleaned.includes(item)) {
        const next = cleaned.filter((x) => x !== item);
        return next.length > 0 ? next : ['None declared'];
      }
      return [...cleaned, item];
    });
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      onToast('Photo must be under 2 MB', 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotos([reader.result]);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCreateDonation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await apiFetch<{ donation: Donation }>('/api/donations', {
        method: 'POST',
        body: JSON.stringify({
          title,
          category,
          dietaryType,
          allergens,
          portions: Number(portions),
          quantityKg: Number(quantityKg),
          preparedAt: new Date(preparedAt).toISOString(),
          readyBy: new Date(readyBy).toISOString(),
          pickupWindowEnd: new Date(pickupWindowEnd).toISOString(),
          storageMethod,
          temperatureC: temperatureC ? Number(temperatureC) : undefined,
          packaging,
          photos,
          isBulkEvent,
          eventName: isBulkEvent ? eventName || title : undefined,
        }),
      });
      await onRefresh();
      onToast(`Submitted "${res.donation.title}" for safety review`);
      onSelectDonation(res.donation);
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleQuickDonate = async () => {
    const last = myDonations[0];
    if (!last) {
      onToast('No previous donation to clone', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiFetch<{ donation: Donation }>('/api/donations', {
        method: 'POST',
        body: JSON.stringify({
          title: `${last.title} (Quick Repeat)`,
          category: last.category,
          dietaryType: last.dietaryType,
          allergens: last.allergens,
          portions: last.portions,
          quantityKg: last.quantityKg,
          preparedAt: new Date(Date.now() - 15 * 60000).toISOString(),
          readyBy: new Date(Date.now() + 5 * 60000).toISOString(),
          pickupWindowEnd: new Date(Date.now() + 180 * 60000).toISOString(),
          storageMethod: last.storageMethod,
          temperatureC: last.temperatureC,
          packaging: last.packaging,
          photos: last.photos,
        }),
      });
      await onRefresh();
      onToast(`Quick Donate submitted "${res.donation.title}"`);
      onSelectDonation(res.donation);
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch('/api/donor/recurring-templates', {
        method: 'POST',
        body: JSON.stringify({
          title: tmplTitle,
          category,
          dietaryType,
          allergens,
          portions,
          quantityKg,
          storageMethod,
          packaging,
          scheduleLabel: tmplSchedule,
        }),
      });
      await onRefresh();
      onToast('Recurring schedule template saved');
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  const filteredDonations = myDonations.filter((d) => {
    if (statusFilter !== 'ALL' && d.status !== statusFilter) return false;
    if (
      searchQuery &&
      !d.title.toLowerCase().includes(searchQuery.toLowerCase()) &&
      !d.category.toLowerCase().includes(searchQuery.toLowerCase())
    ) {
      return false;
    }
    return true;
  });

  if (activeTab === 'csr') {
    return (
      <div className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h2 className="text-lg font-bold text-slate-900 mb-1">Donor Impact & CSR Badges</h2>
          <p className="text-xs text-slate-500 mb-5">
            Profile: {donorProfile?.organizationName} · FSSAI Ref (unverified field):{' '}
            <span className="font-mono">{donorProfile?.fssaiLicenseNumber || 'Not entered'}</span>
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div className="p-4 rounded-lg bg-[#F8FAF9] border border-slate-200">
              <p className="text-xs text-slate-500">Completed Meals</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800">{totalMeals}</p>
            </div>
            <div className="p-4 rounded-lg bg-[#F8FAF9] border border-slate-200">
              <p className="text-xs text-slate-500">Food Redistributed</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-slate-900">{totalKg} kg</p>
            </div>
            <div className="p-4 rounded-lg bg-[#F8FAF9] border border-slate-200">
              <p className="text-xs text-slate-500">Estimated CO2e Avoided</p>
              <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800">{estCo2} kg</p>
            </div>
          </div>

          <h3 className="text-sm font-bold text-slate-900 mb-3">Milestone Badges</h3>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
            {badges.map((b) => (
              <div
                key={b.name}
                className={`p-3.5 rounded-lg border ${
                  b.unlocked
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-slate-50 border-slate-200 text-slate-500'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Award className={`w-4 h-4 ${b.unlocked ? 'text-emerald-700' : 'text-slate-400'}`} />
                  <span className="text-xs font-bold">{b.name}</span>
                </div>
                <p className="text-[11px]">{b.unlocked ? 'Earned' : `Locked · ${b.req}`}</p>
              </div>
            ))}
          </div>

          <h3 className="text-sm font-bold text-slate-900 mb-3">Downloadable Donation Certificates</h3>
          {state.certificates.length === 0 ? (
            <p className="text-xs text-slate-500">Complete a handover to generate verifiable certificates.</p>
          ) : (
            <div className="space-y-2">
              {state.certificates.map((cert) => (
                <div
                  key={cert.id}
                  className="p-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <span className="font-mono font-bold text-slate-900">{cert.id}</span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span className="font-medium text-slate-800">{cert.payload.title}</span>
                    <span className="mx-2 text-slate-400">·</span>
                    <span className="text-slate-600">{cert.payload.ngoName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => downloadCertificatePdf(cert)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-white bg-emerald-700 rounded-md hover:bg-emerald-800 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadCertificateJson(cert)}
                      className="px-2.5 py-1.5 font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-50 cursor-pointer"
                    >
                      JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => onOpenCertificate(cert.id)}
                      className="px-2.5 py-1.5 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                    >
                      Verify
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPIs + Quick Actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Total Meals Rescued</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-emerald-800 mt-1">{totalMeals}</p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Completed Kg</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{totalKg} kg</p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-xs text-slate-500">Est. CO2e Avoided</p>
          <p className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">{estCo2} kg</p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl flex flex-col justify-between gap-2">
          <p className="text-xs text-slate-500">One-Tap Repeat</p>
          <button
            type="button"
            disabled={submitting}
            onClick={handleQuickDonate}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
          >
            <Copy className="w-3.5 h-3.5" />
            {tr(lang, 'quickDonate')}
          </button>
        </div>
      </div>

      {/* AI Insights Strip */}
      {insights && insights.insights.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-emerald-700" />
              Operational Insights
            </h3>
            <span className="text-[11px] text-slate-500">
              {insights.source === 'fallback'
                ? 'AI unavailable, showing rule-based result'
                : insights.source === 'sample_demo'
                ? 'Sample AI output'
                : 'Gemini summary'}
            </span>
          </div>
          <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-slate-700">
            {insights.insights.slice(0, 3).map((item, idx) => (
              <li key={idx} className="p-2.5 rounded-lg bg-[#F8FAF9] border border-slate-200">
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Create Donation & Recurring Templates */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleCreateDonation}
          className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 space-y-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-base font-bold text-slate-900">{tr(lang, 'createDonation')}</h2>
              <p className="text-xs text-slate-500">
                Submits Food Safety Passport + Gemini visual/text screening for admin approval
              </p>
            </div>
            <label className="inline-flex items-center gap-2 text-xs font-semibold text-amber-900 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-lg cursor-pointer">
              <input
                type="checkbox"
                checked={isBulkEvent}
                onChange={(e) => setIsBulkEvent(e.target.checked)}
              />
              <BellRing className="w-3.5 h-3.5" />
              {tr(lang, 'bulkEvent')}
            </label>
          </div>

          {isBulkEvent && (
            <div>
              <label htmlFor="don-event-name" className="block text-xs font-medium text-slate-700 mb-1">
                Event Name (Broadcasts to Top 3 NGOs upon approval; first valid accept wins)
              </label>
              <input
                id="don-event-name"
                type="text"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                placeholder="e.g. Annual Tech Summit Reception Surplus"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="don-title" className="block text-xs font-medium text-slate-700 mb-1">
                Food Title
              </label>
              <input
                id="don-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-cat" className="block text-xs font-medium text-slate-700 mb-1">
                Category
              </label>
              <select
                id="don-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as FoodCategory)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label htmlFor="don-diet" className="block text-xs font-medium text-slate-700 mb-1">
                Dietary Type
              </label>
              <select
                id="don-diet"
                value={dietaryType}
                onChange={(e) => setDietaryType(e.target.value as DietaryType)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                <option value="Veg">Veg</option>
                <option value="Non-veg">Non-veg</option>
                <option value="Contains egg">Contains egg</option>
              </select>
            </div>
            <div>
              <label htmlFor="don-portions" className="block text-xs font-medium text-slate-700 mb-1">
                Portions (Meals)
              </label>
              <input
                id="don-portions"
                type="number"
                min={1}
                max={5000}
                required
                value={portions}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setPortions(val);
                  setQuantityKg(Math.round(val * 0.4 * 10) / 10);
                }}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-kg" className="block text-xs font-medium text-slate-700 mb-1">
                Weight (kg)
              </label>
              <input
                id="don-kg"
                type="number"
                step="0.1"
                min={0.1}
                required
                value={quantityKg}
                onChange={(e) => setQuantityKg(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-storage" className="block text-xs font-medium text-slate-700 mb-1">
                Storage Method
              </label>
              <select
                id="don-storage"
                value={storageMethod}
                onChange={(e) => setStorageMethod(e.target.value as StorageMethod)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              >
                <option value="Hot Held">Hot Held</option>
                <option value="Refrigerated">Refrigerated</option>
                <option value="Ambient">Ambient</option>
                <option value="Frozen">Frozen</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="don-prep" className="block text-xs font-medium text-slate-700 mb-1">
                Preparation Time
              </label>
              <input
                id="don-prep"
                type="datetime-local"
                required
                value={preparedAt}
                onChange={(e) => setPreparedAt(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-ready" className="block text-xs font-medium text-slate-700 mb-1">
                Ready By
              </label>
              <input
                id="don-ready"
                type="datetime-local"
                required
                value={readyBy}
                onChange={(e) => setReadyBy(e.target.value)}
                className="w-full px-3 py-2 text-xs font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-temp" className="block text-xs font-medium text-slate-700 mb-1">
                Temp (°C, optional)
              </label>
              <input
                id="don-temp"
                type="number"
                value={temperatureC}
                onChange={(e) => setTemperatureC(e.target.value)}
                placeholder="e.g. 68"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <span className="block text-xs font-medium text-slate-700 mb-1.5">Allergens</span>
            <div className="flex flex-wrap gap-2">
              {ALLERGENS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => toggleAllergen(a)}
                  className={`px-2.5 py-1 text-xs rounded-md border cursor-pointer ${
                    allergens.includes(a)
                      ? 'bg-emerald-700 text-white border-emerald-700'
                      : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-end">
            <div>
              <label htmlFor="don-pack" className="block text-xs font-medium text-slate-700 mb-1">
                Packaging
              </label>
              <input
                id="don-pack"
                value={packaging}
                onChange={(e) => setPackaging(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="don-photo" className="block text-xs font-medium text-slate-700 mb-1">
                Food Photo (upload or use sample)
              </label>
              <input
                id="don-photo"
                type="file"
                accept="image/*"
                onChange={handlePhotoUpload}
                className="w-full text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-slate-300 file:bg-slate-50 file:text-xs file:font-semibold"
              />
            </div>
          </div>

          {!lowDataMode && photos[0] && (
            <div className="flex items-center gap-3 text-xs text-slate-600">
              <img
                src={photos[0]}
                alt="Donation preview"
                className="w-16 h-12 object-cover rounded-md border border-slate-200"
              />
              <span>Photo attached for Gemini visible-condition inspection</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {submitting ? 'Running Safety Screening...' : 'Submit Donation for Safety Review'}
          </button>
        </form>

        {/* Recurring Schedules Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-slate-100">
            <Repeat className="w-4 h-4 text-emerald-700" />
            <h3 className="text-base font-bold text-slate-900">Recurring Donation Schedules</h3>
          </div>

          <div className="space-y-2.5">
            {(donorProfile?.recurringTemplates ?? []).map((t) => (
              <div
                key={t.id}
                className="p-3 rounded-lg border border-slate-200 bg-[#F8FAF9] flex items-center justify-between gap-2 text-xs"
              >
                <div>
                  <p className="font-semibold text-slate-900">{t.title}</p>
                  <p className="text-slate-600">
                    {t.portions} meals · {t.category} · {t.scheduleLabel}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTitle(t.title);
                    setCategory(t.category);
                    setDietaryType(t.dietaryType);
                    setPortions(t.portions);
                    setQuantityKg(t.quantityKg);
                    setStorageMethod(t.storageMethod);
                    setPackaging(t.packaging);
                    onToast(`Loaded "${t.title}" into donation form`);
                  }}
                  className="px-2.5 py-1.5 font-semibold text-emerald-800 bg-white border border-emerald-200 rounded-md hover:bg-emerald-50 cursor-pointer shrink-0"
                >
                  Use Now
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={handleSaveTemplate} className="pt-3 border-t border-slate-100 space-y-2.5">
            <p className="text-xs font-semibold text-slate-700">Save Current Form as Recurring Template</p>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={tmplTitle}
                onChange={(e) => setTmplTitle(e.target.value)}
                placeholder="Template name"
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
              <input
                type="text"
                value={tmplSchedule}
                onChange={(e) => setTmplSchedule(e.target.value)}
                placeholder="e.g. Daily at 21:00"
                className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <button
              type="submit"
              className="w-full py-2 text-xs font-semibold text-slate-800 bg-slate-100 border border-slate-200 rounded-lg hover:bg-slate-200 cursor-pointer"
            >
              Save Recurring Schedule
            </button>
          </form>
        </div>
      </div>

      {/* Donor Donations Ledger */}
      <div className="bg-white border border-slate-200 rounded-xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <h3 className="text-base font-bold text-slate-900">Your Donations & Live Tracker</h3>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search donations..."
                className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 rounded-lg"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 text-xs border border-slate-300 rounded-lg"
            >
              <option value="ALL">All Statuses</option>
              <option value="Pending Review">Pending Review</option>
              <option value="Matching">Matching</option>
              <option value="Awaiting NGO Acceptance">Awaiting NGO</option>
              <option value="Accepted">Accepted</option>
              <option value="In Transit">In Transit</option>
              <option value="Completed">Completed</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500">
                <th className="py-2.5 pr-4">Listing</th>
                <th className="py-2.5 pr-4">Qty</th>
                <th className="py-2.5 pr-4">Status</th>
                <th className="py-2.5 pr-4">Safe Until</th>
                <th className="py-2.5 pr-4">Matched NGO</th>
                <th className="py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredDonations.map((d) => {
                const cert = state.certificates.find((c) => c.donationId === d.id);
                const pk = state.pickups.find((p) => p.donationId === d.id);
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-slate-900">{d.title}</p>
                      <p className="text-[11px] text-slate-500">
                        {d.category} · {d.dietaryType}
                      </p>
                    </td>
                    <td className="py-3 pr-4 font-mono tabular-nums">
                      {d.portions}m / {d.quantityKg}kg
                    </td>
                    <td className="py-3 pr-4 font-semibold text-slate-800">
                      {translateStatus(lang, d.status)}
                    </td>
                    <td className="py-3 pr-4 font-mono tabular-nums text-amber-800">
                      {d.status === 'Completed'
                        ? 'Handed over'
                        : formatTimeRemaining(d.safeUntil, Date.now())}
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{d.assignedNgoName || '—'}</td>
                    <td className="py-3 text-right space-x-2 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onSelectDonation(d)}
                        className="px-2.5 py-1 font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-md hover:bg-emerald-100 cursor-pointer"
                      >
                        Inspect
                      </button>
                      {pk?.status === 'Open' && (
                        <button
                          type="button"
                          onClick={async () => {
                            try {
                              await apiFetch(`/api/pickups/${pk.id}/self-deliver`, { method: 'POST' });
                              await onRefresh();
                              onToast('Assigned as Donor Self-Delivery');
                            } catch (err) {
                              onToast((err as Error).message, 'error');
                            }
                          }}
                          className="px-2.5 py-1 font-semibold text-slate-700 border border-slate-300 rounded-md hover:bg-slate-100 cursor-pointer"
                        >
                          Self-Deliver
                        </button>
                      )}
                      {cert && (
                        <button
                          type="button"
                          onClick={() => onOpenCertificate(cert.id)}
                          className="px-2.5 py-1 font-semibold text-white bg-slate-900 rounded-md hover:bg-slate-800 cursor-pointer"
                        >
                          Certificate
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
