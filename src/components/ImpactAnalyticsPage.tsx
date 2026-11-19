import { useEffect, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { apiFetch, type ImpactAnalyticsResponse } from '../utils/api';

interface ImpactAnalyticsPageProps {
  onToast: (msg: string, type?: 'success' | 'error') => void;
}

interface ForecastAiResult {
  source: string;
  narrative: string;
  highSurplusPeriods: string[];
  frequentlyWastedCategories: string[];
  possibleShortages: string[];
  recommendedActions: string[];
}

export function ImpactAnalyticsPage({ onToast }: ImpactAnalyticsPageProps) {
  const [data, setData] = useState<ImpactAnalyticsResponse | null>(null);
  const [forecast, setForecast] = useState<ForecastAiResult | null>(null);
  const [kgPerMeal, setKgPerMeal] = useState(0.4);
  const [co2Factor, setCo2Factor] = useState(2.5);
  const [saving, setSaving] = useState(false);

  const loadAll = async () => {
    try {
      const impactRes = await apiFetch<ImpactAnalyticsResponse>('/api/analytics/impact');
      setData(impactRes);
      setKgPerMeal(impactRes.assumptions.kgPerMeal);
      setCo2Factor(impactRes.assumptions.co2eKgPerKgFood);
      const forecastRes = await apiFetch<ForecastAiResult>('/api/ai/forecast', {
        method: 'POST',
      });
      setForecast(forecastRes);
    } catch (err) {
      onToast((err as Error).message, 'error');
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveAssumptions = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await apiFetch('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          assumptions: { kgPerMeal: Number(kgPerMeal), co2eKgPerKgFood: Number(co2Factor) },
        }),
      });
      await loadAll();
      onToast('Assumptions updated — estimates recalculated');
    } catch (err) {
      onToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!data) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-8 text-sm text-slate-500">
        Loading impact ledger and statistical forecast...
      </div>
    );
  }

  const maxOverTimeKg = Math.max(1, ...data.charts.overTime.map((d) => d.kg));
  const maxFunnel = Math.max(1, ...data.charts.funnel.map((f) => f.count));
  const maxCatKg = Math.max(1, ...data.charts.categoryMix.map((c) => c.kg));
  const maxNgoMeals = Math.max(1, ...data.charts.ngoDistribution.map((n) => n.meals));
  const maxWeekdayKg = Math.max(1, ...data.forecastBaseline.byWeekday.map((w) => w.avgSurplusKg));

  return (
    <div className="space-y-6">
      {/* Measured vs Estimated KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-[11px] text-slate-500">Measured: Kg Rescued</p>
          <p className="text-xl font-bold font-mono tabular-nums text-emerald-800 mt-1">
            {data.kpis.kgRedistributed} kg
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-[11px] text-slate-500">Measured: Meals</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {data.kpis.mealsProvided.toLocaleString()}
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-[11px] text-slate-500">Success Rate</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {data.kpis.successRatePct}%
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-[11px] text-slate-500">Avg Accept · Deliver</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {data.kpis.avgPostToAcceptMins}m · {data.kpis.avgAcceptToDeliverMins}m
          </p>
        </div>
        <div className="p-4 bg-white border border-slate-200 rounded-xl">
          <p className="text-[11px] text-slate-500">Volunteer Pickups</p>
          <p className="text-xl font-bold font-mono tabular-nums text-slate-900 mt-1">
            {data.kpis.volunteerPickups}
          </p>
        </div>
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <p className="text-[11px] font-semibold text-emerald-900">
            Estimate: CO2e Avoided
          </p>
          <p className="text-xl font-bold font-mono tabular-nums text-emerald-900 mt-1">
            {data.kpis.estimatedCo2eKg.toLocaleString()} kg
          </p>
          <p className="text-[10px] text-emerald-800">
            {data.kpis.kgRedistributed} × {data.assumptions.co2eKgPerKgFood}
          </p>
        </div>
      </div>

      {/* Editable Assumptions Panel */}
      <form
        onSubmit={handleSaveAssumptions}
        className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end justify-between gap-4"
      >
        <div>
          <h2 className="text-sm font-bold text-slate-900">Editable Impact Assumptions</h2>
          <p className="text-xs text-slate-500">
            Formula: Estimated CO2e Avoided = Measured Redistributed Kg × Emission Factor
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3 text-xs">
          <div>
            <label htmlFor="assump-kg" className="block text-slate-600 mb-1">
              Kg per Meal
            </label>
            <input
              id="assump-kg"
              type="number"
              step="0.05"
              value={kgPerMeal}
              onChange={(e) => setKgPerMeal(Number(e.target.value))}
              className="w-24 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <div>
            <label htmlFor="assump-co2" className="block text-slate-600 mb-1">
              CO2e Factor (kg CO2e / kg food)
            </label>
            <input
              id="assump-co2"
              type="number"
              step="0.1"
              value={co2Factor}
              onChange={(e) => setCo2Factor(Number(e.target.value))}
              className="w-28 px-2.5 py-1.5 font-mono border border-slate-300 rounded-lg"
            />
          </div>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 font-semibold text-white bg-emerald-700 rounded-lg hover:bg-emerald-800 cursor-pointer"
          >
            Recalculate Estimates
          </button>
        </div>
      </form>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Donations Over Time */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">
            Completed Redistribution Over Last 14 Days (kg)
          </h3>
          <div className="flex items-end gap-1 sm:gap-1.5 h-44 pt-4">
            {data.charts.overTime.map((pt, idx) => (
              <div key={pt.date} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full">
                <div
                  title={`${pt.date}: ${pt.kg} kg (${pt.meals} meals)`}
                  className="w-full bg-emerald-600 rounded-t-xs transition-all"
                  style={{ height: `${Math.max(4, Math.round((pt.kg / maxOverTimeKg) * 100))}%` }}
                />
                <span className="text-[8px] sm:text-[9px] font-mono text-slate-500 mt-1.5 truncate max-w-full">
                  {idx % 2 === 0 ? pt.date.slice(3) : pt.date.slice(3)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 2. Success Funnel */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">
            Lifecycle Conversion Funnel
          </h3>
          <div className="space-y-2.5">
            {data.charts.funnel.map((st) => (
              <div key={st.stage} className="flex items-center gap-2 sm:gap-3 text-xs min-w-0">
                <span className="w-20 sm:w-24 shrink-0 font-medium text-slate-700 truncate">{st.stage}</span>
                <div className="flex-1 min-w-0 h-5 bg-slate-100 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-emerald-700 rounded-md"
                    style={{ width: `${Math.round((st.count / maxFunnel) * 100)}%` }}
                  />
                </div>
                <span className="w-8 sm:w-10 shrink-0 text-right font-mono font-semibold tabular-nums text-slate-900">
                  {st.count}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Category Mix */}
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">
            Category Mix (Completed kg)
          </h3>
          <div className="space-y-2.5">
            {data.charts.categoryMix.map((c) => (
              <div key={c.category} className="flex items-center gap-2 sm:gap-3 text-xs min-w-0">
                <span className="w-28 sm:w-40 shrink-0 truncate font-medium text-slate-700">{c.category}</span>
                <div className="flex-1 min-w-0 h-4 bg-slate-100 rounded-md overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 rounded-md"
                    style={{ width: `${Math.round((c.kg / maxCatKg) * 100)}%` }}
                  />
                </div>
                <span className="w-14 sm:w-16 shrink-0 text-right font-mono tabular-nums text-slate-900">
                  {c.kg} kg
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* 4. NGO Distribution & Rejection Reasons */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-5">
          <div>
            <h3 className="text-sm font-bold text-slate-900 mb-3">
              Top Recipient NGOs (Meals Delivered)
            </h3>
            <div className="space-y-2">
              {data.charts.ngoDistribution.slice(0, 5).map((n) => (
                <div key={n.ngoName} className="flex items-center gap-2 sm:gap-3 text-xs min-w-0">
                  <span className="w-28 sm:w-44 shrink-0 truncate text-slate-700">{n.ngoName}</span>
                  <div className="flex-1 min-w-0 h-3.5 bg-slate-100 rounded overflow-hidden">
                    <div
                      className="h-full bg-slate-800 rounded"
                      style={{ width: `${Math.round((n.meals / maxNgoMeals) * 100)}%` }}
                    />
                  </div>
                  <span className="w-10 sm:w-12 shrink-0 text-right font-mono tabular-nums">{n.meals}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-slate-100">
            <h3 className="text-xs font-bold text-slate-900 mb-2">
              NGO Offer Rejection Reasons
            </h3>
            {data.charts.rejectionReasons.length === 0 ? (
              <p className="text-xs text-slate-500">No rejected offers logged.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {data.charts.rejectionReasons.map((r) => (
                  <div key={r.reason} className="flex justify-between text-slate-700">
                    <span>{r.reason}</span>
                    <span className="font-mono font-semibold">{r.count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Statistical & Gemini Surplus/Demand Forecast */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-700" />
              Surplus & Demand Forecasting
            </h3>
            <p className="text-xs text-slate-500">
              Deterministic moving-average baseline ({data.forecastBaseline.sampleSize} historical records)
              {data.forecastBaseline.isPreliminary ? ' · Preliminary / sample estimate' : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={loadAll}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Forecast
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="lg:col-span-6">
            <p className="text-xs font-semibold text-slate-700 mb-2">
              Predicted Surplus by Weekday (Avg kg / cycle)
            </p>
            <div className="flex items-end gap-2 h-36 pt-3">
              {data.forecastBaseline.byWeekday.map((w) => (
                <div key={w.day} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-[10px] font-mono text-slate-600 mb-1">{w.avgSurplusKg}</span>
                  <div
                    className="w-full bg-emerald-700 rounded-t-sm"
                    style={{
                      height: `${Math.max(8, Math.round((w.avgSurplusKg / maxWeekdayKg) * 100))}%`,
                    }}
                  />
                  <span className="text-[11px] font-semibold text-slate-700 mt-1">{w.day}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 space-y-2.5 text-xs">
            {forecast && (
              <>
                <div className="p-3 rounded-lg bg-[#F8FAF9] border border-slate-200">
                  <p className="text-[11px] text-slate-500 mb-1">
                    {forecast.source === 'fallback'
                      ? 'AI unavailable, showing rule-based result'
                      : forecast.source === 'sample_demo'
                      ? 'Sample AI output'
                      : 'Gemini AI Forecast Narration'}
                  </p>
                  <p className="text-slate-800 leading-relaxed">{forecast.narrative}</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div className="p-2.5 rounded-lg border border-slate-200">
                    <p className="font-semibold text-slate-900 mb-1">Possible Shortages</p>
                    {forecast.possibleShortages.map((s, i) => (
                      <p key={i} className="text-slate-600">
                        {s}
                      </p>
                    ))}
                  </div>
                  <div className="p-2.5 rounded-lg border border-slate-200">
                    <p className="font-semibold text-slate-900 mb-1">Recommended Actions</p>
                    {forecast.recommendedActions.map((a, i) => (
                      <p key={i} className="text-slate-600">
                        {a}
                      </p>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Mandatory Impact Disclaimer Footer */}
      <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 text-xs font-medium text-slate-700">
        {data.disclaimer}
      </div>
    </div>
  );
}
