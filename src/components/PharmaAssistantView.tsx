import { BookOpen, Building2, FilePlus2, Newspaper, Scale, Search, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { persistPharmaDocToFirestore } from '../lib/firebase.ts';
import { Medicine, MPDistrict } from '../types/platform.ts';
import { StatusIndicator } from './DataStatusText.tsx';

interface PharmaAssistantViewProps {
  districts: MPDistrict[];
  medicines: Medicine[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  liveStockQueried?: boolean;
  citations?: {
    title: string;
    sourceName: string;
    sourceUrl: string;
    effectiveDate: string;
    retrievalMode: string;
  }[];
}

export function PharmaAssistantView({ districts, medicines }: PharmaAssistantViewProps) {
  const [subTab, setSubTab] = useState<'CHAT' | 'SEARCH_COMPARE' | 'PRICES' | 'FACILITIES_NEWS' | 'INGEST'>('CHAT');

  // Chat state
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      text: 'Ask about medicine compositions, NPPA ceiling prices vs. MRP, MP hospital/pharmacy regulatory guidelines, Pithampur/Mandideep manufacturing clusters, or live MP stock availability. I do not provide prescriptions, dosage adjustments, or therapeutic substitution decisions.',
    },
  ]);
  const [promptInput, setPromptInput] = useState('');
  const [chatDistrict, setChatDistrict] = useState('ALL');
  const [chatBusy, setChatBusy] = useState(false);

  // Search & compare state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<Medicine[]>(medicines);
  const [compareIds, setCompareIds] = useState<string[]>([medicines[0]?.id ?? '', medicines[1]?.id ?? '']);
  const [compareResult, setCompareResult] = useState<{
    comparisons: {
      medicineA: string;
      medicineB: string;
      equivalenceClass: string;
      note: string;
      mrpDifferenceInr: number;
    }[];
  } | null>(null);

  // Facilities & news
  const [newsItems, setNewsItems] = useState<
    { id: string; headline: string; publicationDate: string; source: string; districtId: string | null; category: string; summary: string; originalLink: string; dataStatus: 'VERIFIED' | 'SIMULATED' }[]
  >([]);
  const [facilities, setFacilities] = useState<
    { id: string; name: string; facilityType: string; districtId: string; city: string; bedCapacity: number | null; hfrId: string; source: string; dataStatus: 'VERIFIED' | 'SIMULATED' }[]
  >([]);
  const [manufacturers, setManufacturers] = useState<{
    mpManufacturingUnits: { id: string; name: string; licenseNumber: string; districtId: string }[];
    brandManufacturers: { name: string; productsCount: number; coldChainProducts: number }[];
  } | null>(null);

  // Document ingestion
  const [docTitle, setDocTitle] = useState('');
  const [docCategory, setDocCategory] = useState<'REGULATORY' | 'PRICING' | 'CLINICAL' | 'FACILITY' | 'NEWS'>('REGULATORY');
  const [docSource, setDocSource] = useState('');
  const [docDistrict, setDocDistrict] = useState('mp-bhopal');
  const [docContent, setDocContent] = useState('');
  const [ingestNotice, setIngestNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      apiFetch<{ news: typeof newsItems }>('/api/pharma/news'),
      apiFetch<{ facilities: typeof facilities }>('/api/pharma/facilities'),
      apiFetch<NonNullable<typeof manufacturers>>('/api/pharma/manufacturers'),
    ])
      .then(([n, f, m]) => {
        setNewsItems(n.news);
        setFacilities(f.facilities);
        setManufacturers(m);
      })
      .catch(() => {});
  }, []);

  async function handleSendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!promptInput.trim() || chatBusy) return;
    const question = promptInput.trim();
    setPromptInput('');
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setChatBusy(true);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        answer: string;
        citations: ChatMessage['citations'];
        liveStockQueried: boolean;
        modelUsed: string;
      }>('/api/pharma/chat', {
        method: 'POST',
        body: JSON.stringify({
          message: question,
          districtId: chatDistrict,
        }),
      });
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: res.answer,
          citations: res.citations,
          liveStockQueried: res.liveStockQueried,
          modelUsed: res.modelUsed,
        },
      ]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Assistant request failed.');
    } finally {
      setChatBusy(false);
    }
  }

  async function handleSearchMedicines(q: string) {
    setSearchQuery(q);
    try {
      const res = await apiFetch<{ medicines: Medicine[] }>(`/api/pharma/search?q=${encodeURIComponent(q)}`);
      setSearchResults(res.medicines);
    } catch {
      // ignore
    }
  }

  async function handleCompare() {
    if (compareIds.filter(Boolean).length < 2) return;
    setErrorMsg(null);
    try {
      const res = await apiFetch<NonNullable<typeof compareResult>>('/api/pharma/compare', {
        method: 'POST',
        body: JSON.stringify({ medicineIds: compareIds }),
      });
      setCompareResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Comparison failed.');
    }
  }

  async function handleIngestDocument(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setIngestNotice(null);
    try {
      const res = await apiFetch<{ document: { id: string; title: string }; chunksIndexed: number }>(
        '/api/pharma/documents/ingest',
        {
          method: 'POST',
          body: JSON.stringify({
            title: docTitle,
            category: docCategory,
            sourceName: docSource,
            districtId: docDistrict,
            content: docContent,
            approved: true,
          }),
        }
      );
      await persistPharmaDocToFirestore({
        docId: res.document.id,
        title: docTitle,
        category: docCategory,
        sourceName: docSource || 'Authorized MP Operator Upload',
        districtId: docDistrict,
        contentSummary: docContent,
      });
      setIngestNotice(`Ingested "${res.document.title}" (${res.chunksIndexed} RAG vector chunks indexed).`);
      setDocTitle('');
      setDocSource('');
      setDocContent('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Document ingestion failed.');
    }
  }

  const quickQuestions = [
    'Compare Augmentin 625 Duo and Clavam 625 composition and NPPA ceiling price.',
    'What is the current live stock of Basalog Insulin Glargine in Sehore and Bhopal?',
    'What cold-chain rules apply under Madhya Pradesh State Pharmacy Council?',
    'List ABDM Health Facility Registry referral hospitals in Madhya Pradesh.',
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Pharmaceutical Knowledge Assistant (LLM + RAG)
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Source-cited retrieval across NPPA DPCO pricing, MP State Pharmacy Council circulars, ABDM HFR hospitals, Invest MP briefs, and live Supply Agent stock.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1">
          {[
            { id: 'CHAT', label: 'Knowledge Chat', icon: BookOpen },
            { id: 'SEARCH_COMPARE', label: 'Search & Compare', icon: Scale },
            { id: 'PRICES', label: 'NPPA & MRP Prices', icon: Search },
            { id: 'FACILITIES_NEWS', label: 'MP Facilities & News', icon: Building2 },
            { id: 'INGEST', label: 'Ingest Document', icon: FilePlus2 },
          ].map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as typeof subTab)}
              className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                subTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-800">
          {errorMsg}
        </div>
      )}

      {subTab === 'CHAT' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="lg:col-span-8 flex flex-col rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 text-xs text-slate-600">
              <span>Safety Guardrail: Advisory knowledge only · No prescriptions or dosage changes</span>
              <select
                value={chatDistrict}
                onChange={(e) => setChatDistrict(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
              >
                <option value="ALL">All MP Districts</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1 space-y-4 p-4 max-h-[460px] overflow-y-auto">
              {messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`rounded-lg border p-3.5 text-sm ${
                    m.role === 'user'
                      ? 'ml-auto max-w-2xl border-teal-200 bg-teal-50/50 text-slate-900'
                      : 'mr-auto max-w-3xl border-slate-200 bg-white text-slate-800'
                  }`}
                >
                  <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="font-semibold text-slate-700">
                      {m.role === 'user' ? 'Operator Query' : 'RouteRescue Knowledge Assistant'}
                    </span>
                    {m.modelUsed && (
                      <span className="font-mono">
                        {m.modelUsed} {m.liveStockQueried ? '· Live Supply Agent Queried' : ''}
                      </span>
                    )}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  {m.citations && m.citations.length > 0 && (
                    <div className="mt-3 border-t border-slate-100 pt-2 space-y-1">
                      <div className="text-[11px] font-semibold text-slate-600">Grounded Sources:</div>
                      {m.citations.map((c, ci) => (
                        <div key={ci} className="text-[11px] text-slate-500">
                          [{ci + 1}] {c.title} · {c.sourceName} (Effective {c.effectiveDate}) ·{' '}
                          <span className="font-mono">{c.retrievalMode}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {chatBusy && (
                <div className="text-xs text-slate-500">Retrieving vector chunks &amp; generating source-cited answer...</div>
              )}
            </div>

            <form onSubmit={handleSendChat} className="flex items-center gap-2 border-t border-slate-200 p-3">
              <input
                type="text"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                placeholder="Ask about medicine composition, NPPA ceiling price, MP stock, or regulatory rules..."
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
              <button
                type="submit"
                disabled={chatBusy}
                className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50"
              >
                <Send className="h-3.5 w-3.5" /> Ask
              </button>
            </form>
          </div>

          <div className="lg:col-span-4 space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="text-sm font-semibold text-slate-900">Sample Grounded Queries</h2>
              <div className="mt-3 space-y-2">
                {quickQuestions.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPromptInput(q)}
                    className="w-full rounded-md border border-slate-200 bg-slate-50/70 p-2.5 text-left text-xs text-slate-700 hover:border-teal-600 hover:bg-white"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-600 space-y-1.5">
              <h2 className="text-sm font-semibold text-slate-900">Clinical &amp; Regulatory Boundaries</h2>
              <p>1. Never provides prescriptions or clinical diagnoses.</p>
              <p>2. Never recommends dosage alterations.</p>
              <p>3. Distinguishes identical composition from non-equivalent brands.</p>
              <p>4. Separates NPPA ceiling price from MRP, retail, and distributor rates.</p>
            </div>
          </div>
        </div>
      )}

      {subTab === 'SEARCH_COMPARE' && (
        <div className="space-y-6">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <h2 className="text-base font-semibold text-slate-900">Brand Composition &amp; Equivalence Comparator</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <select
                value={compareIds[0]}
                onChange={(e) => setCompareIds([e.target.value, compareIds[1]])}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brandName} ({m.genericName})
                  </option>
                ))}
              </select>
              <select
                value={compareIds[1]}
                onChange={(e) => setCompareIds([compareIds[0], e.target.value])}
                className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {medicines.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brandName} ({m.genericName})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleCompare}
                className="rounded-md bg-slate-900 px-4 py-2 text-xs font-medium text-white hover:bg-slate-800"
              >
                Compare Composition &amp; Price
              </button>
            </div>
            {compareResult && (
              <div className="border-t border-slate-200 pt-3 space-y-2 text-xs">
                {compareResult.comparisons.map((c, idx) => (
                  <div key={idx} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                    <div className="font-semibold text-slate-900">
                      {c.medicineA} vs. {c.medicineB} — {c.equivalenceClass.replace(/_/g, ' ')}
                    </div>
                    <p className="mt-1 text-slate-700">{c.note}</p>
                    <p className="mt-1 font-mono text-slate-600">
                      MRP Delta: ₹{c.mrpDifferenceInr}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-base font-semibold text-slate-900">Medicine &amp; Formulation Directory</h2>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => handleSearchMedicines(e.target.value)}
                placeholder="Search brand, generic, active ingredient..."
                className="w-full max-w-xs rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900"
              />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-medium">Brand &amp; Generic</th>
                    <th className="px-3 py-2 font-medium">Composition &amp; Dosage Form</th>
                    <th className="px-3 py-2 font-medium">Pack Size</th>
                    <th className="px-3 py-2 font-medium">Manufacturer</th>
                    <th className="px-3 py-2 font-medium">Storage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {searchResults.map((m) => (
                    <tr key={m.id}>
                      <td className="px-3 py-2.5">
                        <div className="font-semibold text-slate-900">{m.brandName}</div>
                        <div className="text-slate-600">{m.genericName}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">
                        <div>{m.composition}</div>
                        <div className="text-slate-500">{m.dosageForm} · {m.scheduleType}</div>
                      </td>
                      <td className="px-3 py-2.5 text-slate-700">{m.packSize}</td>
                      <td className="px-3 py-2.5 text-slate-700">{m.manufacturer}</td>
                      <td className="px-3 py-2.5 font-mono">
                        {m.coldChainRequired ? '2°C–8°C Cold Chain' : 'Ambient'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {subTab === 'PRICES' && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-5 py-3">
            <h2 className="text-base font-semibold text-slate-900">
              Verified Price Ledger (NPPA Ceiling vs. MRP vs. Retail vs. Distributor)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Statutory NPPA ceiling prices apply per pack size exclusive of local taxes; effective dates and sources displayed per row.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Medicine &amp; Pack Size</th>
                  <th className="px-4 py-2.5 font-medium text-right">NPPA Ceiling</th>
                  <th className="px-4 py-2.5 font-medium text-right">MRP</th>
                  <th className="px-4 py-2.5 font-medium text-right">Retail Price</th>
                  <th className="px-4 py-2.5 font-medium text-right">Dist. Purchase</th>
                  <th className="px-4 py-2.5 font-medium">Source &amp; Effective Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {medicines.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{m.brandName} ({m.strength})</div>
                      <div className="text-slate-500">{m.packSize}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-teal-800 font-semibold">
                      {m.nppaCeilingPriceInr !== null ? `₹${m.nppaCeilingPriceInr.toFixed(2)}` : 'Non-Scheduled'}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-900">
                      ₹{m.mrpInr.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      ₹{m.retailSellingPriceInr.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono tabular-nums text-slate-700">
                      ₹{m.distributorPurchasePriceInr.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      <div>{m.priceSource}</div>
                      <div className="font-mono text-[11px] text-slate-500">
                        Effective {m.priceEffectiveDate} · <StatusIndicator status={m.dataStatus} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'FACILITIES_NEWS' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">MP Healthcare Facilities (ABDM HFR)</h2>
              <Building2 className="h-4 w-4 text-slate-400" />
            </div>
            <div className="divide-y divide-slate-100">
              {facilities.map((f) => (
                <div key={f.id} className="py-2.5 first:pt-0 last:pb-0 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">{f.name}</span>
                    <StatusIndicator status={f.dataStatus} />
                  </div>
                  <div className="mt-0.5 text-slate-600">
                    {f.facilityType} · {f.city} · HFR ID <span className="font-mono">{f.hfrId}</span> · Beds: <span className="font-mono">{f.bedCapacity ?? 'Unavailable'}</span>
                  </div>
                </div>
              ))}
            </div>
            {manufacturers && (
              <div className="border-t border-slate-200 pt-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  MP Manufacturing Clusters (Pithampur / Mandideep)
                </h3>
                <div className="mt-2 space-y-1.5 text-xs text-slate-700">
                  {manufacturers.mpManufacturingUnits.map((u) => (
                    <div key={u.id}>
                      <strong>{u.name}</strong> · License <span className="font-mono">{u.licenseNumber}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">Madhya Pradesh Pharmaceutical News</h2>
              <Newspaper className="h-4 w-4 text-slate-400" />
            </div>
            <div className="divide-y divide-slate-100">
              {newsItems.map((n) => (
                <div key={n.id} className="py-3 first:pt-0 last:pb-0 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2 text-slate-500">
                    <span>{n.category} · {n.publicationDate}</span>
                    <StatusIndicator status={n.dataStatus} />
                  </div>
                  <div className="text-sm font-semibold text-slate-900">{n.headline}</div>
                  <p className="text-slate-600 leading-relaxed">{n.summary}</p>
                  <div className="text-slate-500">
                    Source: {n.source} ·{' '}
                    <a
                      href={n.originalLink}
                      target="_blank"
                      rel="noreferrer"
                      className="text-teal-700 underline hover:text-teal-900"
                    >
                      Reference Portal
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {subTab === 'INGEST' && (
        <form onSubmit={handleIngestDocument} className="max-w-2xl rounded-lg border border-slate-200 bg-white p-5 space-y-4">
          <h2 className="text-base font-semibold text-slate-900">
            Ingest Approved Pharmaceutical Document into RAG Index
          </h2>
          <p className="text-xs text-slate-600">
            Documents are cleaned, chunked, embedded via Gemini Embeddings (`gemini-embedding-2`), and immediately available for citation-backed RAG retrieval.
          </p>
          {ingestNotice && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
              {ingestNotice}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-medium text-slate-700 sm:col-span-2">
              Document Title
              <input
                type="text"
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                required
                placeholder="e.g., MP Health Dept Emergency Insulin Circular Nov 2026"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              Category
              <select
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value as typeof docCategory)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                <option value="REGULATORY">REGULATORY</option>
                <option value="PRICING">PRICING</option>
                <option value="CLINICAL">CLINICAL</option>
                <option value="FACILITY">FACILITY</option>
                <option value="NEWS">NEWS</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              MP District Scope
              <select
                value={docDistrict}
                onChange={(e) => setDocDistrict(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
              >
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700 sm:col-span-2">
              Source Authority / Publisher
              <input
                type="text"
                value={docSource}
                onChange={(e) => setDocSource(e.target.value)}
                required
                placeholder="e.g., MP FDA / NPPA / District CMO"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700 sm:col-span-2">
              Approved Document Content
              <textarea
                rows={5}
                value={docContent}
                onChange={(e) => setDocContent(e.target.value)}
                required
                placeholder="Paste verified circular text, DPCO pricing notification, or facility advisory..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </label>
          </div>
          <button
            type="submit"
            className="rounded-lg bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800"
          >
            Validate, Chunk &amp; Index Document
          </button>
        </form>
      )}
    </div>
  );
}
