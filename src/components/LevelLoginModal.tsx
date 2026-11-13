import { Building2, Lock, MapPin, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { User } from 'firebase/auth';
import { apiFetch } from '../lib/api.ts';
import { signInWithGoogle, syncUserProfileToFirestore } from '../lib/firebase.ts';
import {
  ActiveLevelSession,
  DistributionNode,
  MPDistrict,
  OperationalNeedProfile,
  UserRole,
} from '../types/platform.ts';
import { formatLevelLabel } from './DataStatusText.tsx';

interface LevelLoginModalProps {
  open: boolean;
  initialLevel: UserRole;
  currentSession: ActiveLevelSession | null;
  districts: MPDistrict[];
  nodes: DistributionNode[];
  levelNeeds: OperationalNeedProfile[];
  firebaseUser: User | null;
  onClose: () => void;
  onAuthenticated: (session: ActiveLevelSession, role: UserRole) => void;
}

const ALL_LEVELS: UserRole[] = [
  'MANUFACTURER',
  'CNF_AGENT',
  'SUPER_STOCKIST',
  'WHOLESALER',
  'LOCAL_DISTRIBUTOR',
  'RETAIL_PHARMACY',
  'HOSPITAL_PHARMACY',
  'STATE_ADMIN',
];

export function LevelLoginModal({
  open,
  initialLevel,
  currentSession,
  districts,
  nodes,
  levelNeeds,
  firebaseUser,
  onClose,
  onAuthenticated,
}: LevelLoginModalProps) {
  const [selectedLevel, setSelectedLevel] = useState<UserRole>(initialLevel);
  const [organizationName, setOrganizationName] = useState('');
  const [districtId, setDistrictId] = useState(districts[0]?.id ?? 'mp-bhopal');
  const [fullAddress, setFullAddress] = useState('');
  const [pinCode, setPinCode] = useState('462001');
  const [licenseNumber, setLicenseNumber] = useState('MP/FDA/20B/462001');
  const [phone, setPhone] = useState('');
  const [responseSlaMinutes, setResponseSlaMinutes] = useState(15);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const prefillForLevel = (lvl: UserRole) => {
    const sampleNode = nodes.find((n) => n.level === lvl) ?? nodes[0];
    const need = levelNeeds.find((n) => n.level === lvl);
    if (lvl === 'STATE_ADMIN') {
      setOrganizationName('MP Directorate of Health & FDA Command Desk');
      setDistrictId('mp-bhopal');
      setFullAddress('Satpura Bhawan, 4th Floor, Arera Hills, Bhopal, Madhya Pradesh');
      setPinCode('462004');
      setLicenseNumber('MP/GOV/FDA-CMD-01');
      setResponseSlaMinutes(10);
      return;
    }
    if (sampleNode) {
      setOrganizationName(sampleNode.name);
      setDistrictId(sampleNode.districtId);
      setFullAddress(sampleNode.fullAddress);
      setPinCode(sampleNode.pinCode);
      setLicenseNumber(`MP/FDA/${lvl.slice(0, 3)}/${sampleNode.pinCode}`);
      setResponseSlaMinutes(need?.targetResponseSlaMinutes ?? 15);
    }
  };

  useEffect(() => {
    if (!open) return;
    setSelectedLevel(initialLevel);
    if (currentSession && currentSession.level === initialLevel) {
      setOrganizationName(currentSession.organizationName);
      setDistrictId(currentSession.districtId);
      setFullAddress(currentSession.fullAddress);
      setPinCode(currentSession.pinCode);
      setLicenseNumber(currentSession.licenseNumber);
      setResponseSlaMinutes(currentSession.responseSlaMinutes);
    } else {
      prefillForLevel(initialLevel);
    }
    setErrorMsg(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialLevel]);

  if (!open) return null;

  const activeNeed = levelNeeds.find((n) => n.level === selectedLevel);

  async function handleSubmit(withGoogleSignIn: boolean) {
    setBusy(true);
    setErrorMsg(null);
    try {
      let activeUser = firebaseUser;
      if (withGoogleSignIn && !activeUser) {
        activeUser = await signInWithGoogle();
      }

      const verified = await apiFetch<{
        verified: boolean;
        level: UserRole;
        districtName: string;
        organizationName: string;
        fullAddress: string;
        pinCode: string;
        licenseNumber: string;
        privateContactStored: boolean;
        responseSlaMinutes: number;
      }>('/api/levels/login-profile', {
        method: 'POST',
        body: JSON.stringify({
          level: selectedLevel,
          organizationName,
          districtId,
          fullAddress,
          pinCode,
          licenseNumber,
          phone: phone.trim() || undefined,
          responseSlaMinutes,
        }),
      });

      if (activeUser && activeUser.emailVerified) {
        await syncUserProfileToFirestore(activeUser, selectedLevel, districtId, {
          organizationName: verified.organizationName,
          pinCode: verified.pinCode,
          phone: phone.trim() || undefined,
          fullAddress: verified.fullAddress,
          responseSlaMinutes: verified.responseSlaMinutes,
        });
      }

      onAuthenticated(
        {
          level: verified.level,
          organizationName: verified.organizationName,
          districtId,
          districtName: verified.districtName,
          fullAddress: verified.fullAddress,
          pinCode: verified.pinCode,
          licenseNumber: verified.licenseNumber,
          responseSlaMinutes: verified.responseSlaMinutes,
          privateContactStored: verified.privateContactStored,
        },
        selectedLevel
      );
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to verify level profile & MP address.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Distribution Level Login and Address Verification"
    >
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              Tier Login &amp; Full MP Facility Address Verification
            </h2>
            <p className="mt-0.5 text-xs text-slate-600">
              Authenticate operator workspace for any Madhya Pradesh distribution level with street-level address, PIN (45xxxx–48xxxx), and isolated private duty contact.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close login modal"
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-5">
          {/* Tier Selector Grid */}
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Select Supply-Chain Distribution Level
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ALL_LEVELS.map((lvl) => {
                const active = selectedLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => {
                      setSelectedLevel(lvl);
                      prefillForLevel(lvl);
                    }}
                    className={`rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                      active
                        ? 'border-teal-700 bg-teal-50 font-semibold text-teal-900'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <div className="truncate">{formatLevelLabel(lvl)}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-slate-500">
                      {lvl === 'STATE_ADMIN' ? 'All-Tier Oversight' : `${nodes.filter((n) => n.level === lvl).length} MP node(s)`}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Defined Need & Related Info for Selected Tier */}
          {activeNeed && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">
                  Defined Need &amp; Related Scope — {activeNeed.label}
                </span>
                <span className="font-mono text-[11px] text-teal-800">
                  Target SLA {activeNeed.targetResponseSlaMinutes} min
                </span>
              </div>
              <p className="text-slate-700">
                <strong className="text-slate-900">Primary Need:</strong> {activeNeed.primaryNeed}
              </p>
              <p className="text-slate-600">
                <strong className="text-slate-800">Related Info:</strong> {activeNeed.relatedInfo}
              </p>
              <div className="text-[11px] text-slate-500">
                Upstream: {activeNeed.upstreamDependency} · Downstream: {activeNeed.downstreamImpact} · Compliance: {activeNeed.regulatoryConstraint}
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs text-red-800">
              {errorMsg}
            </div>
          )}

          {/* Full Address & Operator Credentials Form */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="block text-xs font-medium text-slate-700">
              Facility / Organization Legal Name
              <input
                type="text"
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Madhya Pradesh District
              <select
                value={districtId}
                onChange={(e) => setDistrictId(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              >
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.division})
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-slate-700 sm:col-span-2">
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 text-teal-700" />
                Full Registered Street / Industrial / Hospital Address (Madhya Pradesh)
              </span>
              <textarea
                rows={2}
                value={fullAddress}
                onChange={(e) => setFullAddress(e.target.value)}
                placeholder="Plot / Building / Road / Locality, City, Madhya Pradesh"
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              MP PIN Code (45xxxx–48xxxx)
              <input
                type="text"
                value={pinCode}
                onChange={(e) => setPinCode(e.target.value)}
                maxLength={6}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              MP FDA Drug License / Registration ID
              <input
                type="text"
                value={licenseNumber}
                onChange={(e) => setLicenseNumber(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              <span className="inline-flex items-center gap-1">
                <Lock className="h-3 w-3 text-slate-500" />
                Private Duty Contact Phone (Isolated PII Only)
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+91-98260-XXXXX (stored privately, never broadcast)"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>

            <label className="block text-xs font-medium text-slate-700">
              Rapid-Reach Response SLA (Minutes)
              <input
                type="number"
                min={5}
                max={120}
                value={responseSlaMinutes}
                onChange={(e) => setResponseSlaMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-teal-700 focus:outline-none"
              />
            </label>
          </div>

          <div className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] text-slate-600">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal-700" />
            <span>
              Privacy Guarantee: Your personal phone and private full address are isolated in private user storage and strictly scoped to verified 1-hop supply partners. They are never included in SSE event streams, CSV/JSON exports, or RAG prompts.
            </span>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => handleSubmit(false)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-900 bg-white px-4 py-2 text-xs font-medium text-slate-900 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
            >
              <Building2 className="h-3.5 w-3.5" />
              {busy ? 'Verifying...' : 'Activate Level Session'}
            </button>
            {!firebaseUser && (
              <button
                type="button"
                disabled={busy}
                onClick={() => handleSubmit(true)}
                className="inline-flex items-center gap-1.5 rounded-md bg-teal-700 px-4 py-2 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50 whitespace-nowrap"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                Sign In with Google &amp; Save Address
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
