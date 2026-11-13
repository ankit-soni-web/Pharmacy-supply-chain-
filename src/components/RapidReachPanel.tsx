import { Lock, PhoneCall, Send, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.ts';
import { persistContactRequestToFirestore } from '../lib/firebase.ts';
import { FastReachRequest, ScopedContactView, UserRole } from '../types/platform.ts';
import { formatLevelLabel, formatTimeShort } from './DataStatusText.tsx';

interface RapidReachPanelProps {
  role: UserRole;
  defaultNeedSummary?: string;
  compact?: boolean;
}

export function RapidReachPanel({ role, defaultNeedSummary, compact = false }: RapidReachPanelProps) {
  const [contacts, setContacts] = useState<ScopedContactView[]>([]);
  const [recentRequests, setRecentRequests] = useState<FastReachRequest[]>([]);
  const [targetNodeId, setTargetNodeId] = useState('');
  const [urgency, setUrgency] = useState<'IMMEDIATE_10M' | 'URGENT_30M'>('IMMEDIATE_10M');
  const [needSummary, setNeedSummary] = useState(
    defaultNeedSummary ?? 'Urgent stock confirmation and immediate 1-hop dispatch readiness required.'
  );
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (defaultNeedSummary) {
      setNeedSummary(defaultNeedSummary);
    }
  }, [defaultNeedSummary]);

  const loadScopedContacts = useCallback(async () => {
    try {
      const res = await apiFetch<{
        contacts: ScopedContactView[];
        recentRequests: FastReachRequest[];
      }>('/api/contacts/scoped');
      setContacts(res.contacts);
      setRecentRequests(res.recentRequests);
      const firstAllowed = res.contacts.find((c) => c.contactVisibility !== 'REDACTED_BEYOND_SCOPE');
      if (firstAllowed) {
        setTargetNodeId((prev) =>
          res.contacts.some((c) => c.nodeId === prev && c.contactVisibility !== 'REDACTED_BEYOND_SCOPE')
            ? prev
            : firstAllowed.nodeId
        );
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load privacy-scoped contacts.');
    }
  }, []);

  useEffect(() => {
    loadScopedContacts();
  }, [loadScopedContacts, role]);

  const unlockedContacts = contacts.filter((c) => c.contactVisibility !== 'REDACTED_BEYOND_SCOPE');
  const redactedContacts = contacts.filter((c) => c.contactVisibility === 'REDACTED_BEYOND_SCOPE');

  async function handleFastReachSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!targetNodeId) return;
    setBusy(true);
    setStatusMsg(null);
    setErrorMsg(null);
    try {
      const res = await apiFetch<{
        request: FastReachRequest;
        directChannel: string | null;
        privacyGuarantee: string;
      }>('/api/contacts/fast-reach', {
        method: 'POST',
        body: JSON.stringify({
          targetNodeId,
          urgency,
          needSummary,
        }),
      });

      await persistContactRequestToFirestore({
        requestId: res.request.id,
        requesterRole: role,
        targetNodeId: res.request.targetNodeId,
        targetLevel: res.request.targetLevel,
        urgency,
        needSummary: res.request.needSummary,
      }).catch(() => {});

      setStatusMsg(
        `Rapid-reach ping sent to ${res.request.targetNodeName} (SLA ${res.request.slaMinutes}m${res.directChannel ? ` · Direct Desk: ${res.directChannel}` : ''}). ${res.privacyGuarantee}`
      );
      await loadScopedContacts();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Rapid-reach request failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-3">
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            1-Hop Rapid-Reach Coordination &amp; Privacy Guard
          </h3>
          <p className="mt-0.5 text-xs text-slate-600">
            Reach immediate adjacent supply partners as fast as possible while strictly withholding direct contacts beyond 1-hop tiers.
          </p>
        </div>
        <div className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-800">
          <ShieldCheck className="h-4 w-4" />
          <span>
            Role: {formatLevelLabel(role)} · {unlockedContacts.length} unlocked / {redactedContacts.length} redacted
          </span>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2 text-xs text-red-800">
          {errorMsg}
        </div>
      )}
      {statusMsg && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs text-emerald-900">
          {statusMsg}
        </div>
      )}

      {/* Rapid Reach Form */}
      <form onSubmit={handleFastReachSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-12">
        <label className="text-xs font-medium text-slate-700 md:col-span-5">
          Target 1-Hop Adjacent Desk
          <select
            value={targetNodeId}
            onChange={(e) => setTargetNodeId(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
          >
            {unlockedContacts.map((c) => (
              <option key={c.nodeId} value={c.nodeId}>
                {c.nodeName} ({formatLevelLabel(c.level)} · SLA {c.slaMinutes}m)
              </option>
            ))}
          </select>
        </label>

        <label className="text-xs font-medium text-slate-700 md:col-span-3">
          Response Speed Target
          <select
            value={urgency}
            onChange={(e) => setUrgency(e.target.value as 'IMMEDIATE_10M' | 'URGENT_30M')}
            className="mt-1 w-full rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
          >
            <option value="IMMEDIATE_10M">IMMEDIATE (10 min SLA)</option>
            <option value="URGENT_30M">URGENT (30 min SLA)</option>
          </select>
        </label>

        <label className="text-xs font-medium text-slate-700 md:col-span-4">
          Need Summary (Shared Only With Target)
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={needSummary}
              onChange={(e) => setNeedSummary(e.target.value)}
              required
              minLength={5}
              className="w-full rounded-md border border-slate-300 px-2.5 py-2 text-xs text-slate-900 focus:border-teal-700 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy || unlockedContacts.length === 0}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-teal-700 px-3 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
            >
              <Send className="h-3.5 w-3.5" />
              {busy ? 'Sending...' : 'Ask to Reach Fast'}
            </button>
          </div>
        </label>
      </form>

      {/* Contact Scope Directory */}
      <div className={`grid grid-cols-1 gap-4 ${compact ? '' : 'lg:grid-cols-2'}`}>
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            In-Scope 1-Hop Contacts ({unlockedContacts.length})
          </div>
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {unlockedContacts.slice(0, compact ? 4 : 12).map((c) => (
              <div key={c.nodeId} className="p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-900">{c.nodeName}</span>
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-teal-800">
                    <PhoneCall className="h-3 w-3" /> {c.directChannel}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-600">
                  {formatLevelLabel(c.level)} · {c.deskName} · SLA {c.slaMinutes}m · {c.shiftHours}
                </div>
                <div className="mt-0.5 text-[11px] text-slate-500">{c.fullAddress}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Privacy Redacted Beyond 1-Hop ({redactedContacts.length}) &amp; Recent Pings
          </div>
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200 bg-slate-50/50">
            {redactedContacts.length === 0 ? (
              <div className="p-3 text-xs text-slate-600">
                State Admin oversight active. Switch role to Retail Pharmacy, Wholesaler, or Manufacturer in the sidebar to observe non-adjacent contact redaction.
              </div>
            ) : (
              redactedContacts.slice(0, 4).map((c) => (
                <div key={c.nodeId} className="p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-slate-800">{c.nodeName}</span>
                    <span className="inline-flex items-center gap-1 font-mono text-[11px] text-slate-500">
                      <Lock className="h-3 w-3" /> {c.maskedChannel}
                    </span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    {formatLevelLabel(c.level)} · {c.privacyNote}
                  </div>
                </div>
              ))
            )}
            {recentRequests.slice(0, 3).map((req) => (
              <div key={req.id} className="bg-white p-2.5 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono font-semibold text-teal-800">
                    {req.urgency} &rarr; {req.targetNodeName}
                  </span>
                  <span className="font-mono text-[11px] text-slate-500">
                    {formatTimeShort(req.createdAt)}
                  </span>
                </div>
                <div className="mt-0.5 text-slate-600">
                  {req.needSummary} · Scope: {req.shareScope}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
