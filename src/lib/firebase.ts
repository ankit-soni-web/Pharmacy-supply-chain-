import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: { providerId?: string | null; email?: string | null }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
    return false;
  }
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleAuthProvider);
  return cred.user;
}

export async function signOutUser() {
  await signOut(auth);
}

export async function syncUserProfileToFirestore(
  user: User,
  role: string,
  districtId: string,
  extra?: {
    organizationName?: string;
    pinCode?: string;
    phone?: string;
    fullAddress?: string;
    responseSlaMinutes?: number;
  }
) {
  if (!user.emailVerified) return;
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const safeRole =
    role === 'STATE_ADMIN' && user.email !== 'ankit.sunar2007@gmail.com' ? 'WHOLESALER' : role;
  const publicUpdates: Record<string, unknown> = {
    uid: user.uid,
    displayName: (user.displayName || 'MP Operator').slice(0, 120),
    role: safeRole,
    districtId,
    organizationName: (extra?.organizationName || 'Madhya Pradesh Supply Chain Network').slice(0, 160),
    updatedAt: serverTimestamp(),
  };
  if (extra?.pinCode && extra.pinCode.trim().length >= 6) {
    publicUpdates.pinCode = extra.pinCode.trim().slice(0, 10);
  }

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        ...publicUpdates,
        createdAt: serverTimestamp(),
      });
    } else {
      await setDoc(userRef, publicUpdates, { merge: true });
    }
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, userPath);
  }

  if (user.email) {
    const privatePath = `users/${user.uid}/private/info`;
    const privateUpdates: Record<string, unknown> = {
      uid: user.uid,
      email: user.email.slice(0, 254),
      updatedAt: serverTimestamp(),
    };
    if (extra?.phone && extra.phone.trim().length >= 6) {
      privateUpdates.phone = extra.phone.trim().slice(0, 24);
    }
    if (extra?.fullAddress && extra.fullAddress.trim().length >= 5) {
      privateUpdates.fullAddress = extra.fullAddress.trim().slice(0, 400);
    }
    if (typeof extra?.responseSlaMinutes === 'number' && extra.responseSlaMinutes >= 1) {
      privateUpdates.responseSlaMinutes = Math.min(1440, Math.round(extra.responseSlaMinutes));
    }

    try {
      await setDoc(doc(db, 'users', user.uid, 'private', 'info'), privateUpdates, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, privatePath);
    }
  }
}

export async function persistApprovalToFirestore(payload: {
  approvalId: string;
  recommendationType: 'REDISTRIBUTION' | 'REPLENISHMENT';
  medicineName: string;
  sourceNodeId: string;
  targetNodeId: string;
  quantity: number;
  status: 'APPROVED' | 'REJECTED';
  reviewerRole: string;
  notes?: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const path = 'approvals';
  try {
    await setDoc(doc(db, path, payload.approvalId), {
      ...payload,
      reviewedByUid: user.uid,
      notes: (payload.notes || '').slice(0, 1000),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, `${path}/${payload.approvalId}`);
  }
}

export async function persistAuditToFirestore(payload: {
  actorRole: string;
  action: string;
  entityType: string;
  entityId: string;
  details: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const entryId = `aud-${Date.now()}`;
  const path = `audit_logs/${entryId}`;
  try {
    await setDoc(doc(db, 'audit_logs', entryId), {
      entryId,
      actorUid: user.uid,
      actorRole: payload.actorRole.slice(0, 64),
      action: payload.action.slice(0, 120),
      entityType: payload.entityType.slice(0, 64),
      entityId: payload.entityId.slice(0, 128),
      details: payload.details.slice(0, 2000),
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function persistPharmaDocToFirestore(payload: {
  docId: string;
  title: string;
  category: 'REGULATORY' | 'PRICING' | 'CLINICAL' | 'FACILITY' | 'NEWS';
  sourceName: string;
  districtId: string;
  contentSummary: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const path = `pharma_documents/${payload.docId}`;
  try {
    await setDoc(doc(db, 'pharma_documents', payload.docId), {
      ...payload,
      contentSummary: payload.contentSummary.slice(0, 10000),
      uploadedByUid: user.uid,
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export async function fetchUserFirestoreAuditLogs(uid: string): Promise<
  {
    id: string;
    actorId: string;
    actorRole: string;
    action: string;
    entityType: string;
    entityId: string;
    details: string;
    timestamp: string;
  }[]
> {
  const path = 'audit_logs';
  try {
    const q = query(collection(db, path), where('actorUid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data() as {
        entryId?: string;
        actorRole?: string;
        action?: string;
        entityType?: string;
        entityId?: string;
        details?: string;
        createdAt?: { toDate?: () => Date };
      };
      return {
        id: data.entryId ?? d.id,
        actorId: uid,
        actorRole: data.actorRole ?? 'OPERATOR',
        action: data.action ?? 'LOGGED_ACTION',
        entityType: data.entityType ?? 'System',
        entityId: data.entityId ?? d.id,
        details: data.details ?? '',
        timestamp: data.createdAt?.toDate ? data.createdAt.toDate().toISOString() : new Date().toISOString(),
      };
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.LIST, path);
    return [];
  }
}

export async function persistContactRequestToFirestore(payload: {
  requestId: string;
  requesterRole: string;
  targetNodeId: string;
  targetLevel: string;
  urgency: 'IMMEDIATE_10M' | 'URGENT_30M';
  needSummary: string;
}) {
  const user = auth.currentUser;
  if (!user || !user.emailVerified) return;
  const path = `contact_requests/${payload.requestId}`;
  try {
    await setDoc(doc(db, 'contact_requests', payload.requestId), {
      requestId: payload.requestId.slice(0, 128),
      requesterUid: user.uid,
      requesterRole: payload.requesterRole.slice(0, 64),
      targetNodeId: payload.targetNodeId.slice(0, 128),
      targetLevel: payload.targetLevel,
      urgency: payload.urgency,
      needSummary: payload.needSummary.slice(0, 500),
      shareScope: 'SINGLE_HOP_ONLY',
      createdAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

