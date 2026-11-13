import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RequestWithAuth } from '../middleware/auth.ts';
import { store } from '../store.ts';
import { PharmaChunk, PharmaDocument } from '../types.ts';
import { queryLiveStockForMedicine } from './supplyAgent.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function cleanText(raw: string): string {
  return raw.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
}

function chunkDocument(doc: PharmaDocument, chunkSize = 480, overlap = 80): PharmaChunk[] {
  const cleaned = cleanText(doc.content);
  const chunks: PharmaChunk[] = [];
  let start = 0;
  let index = 0;
  while (start < cleaned.length) {
    const end = Math.min(cleaned.length, start + chunkSize);
    const slice = cleaned.slice(start, end).trim();
    if (slice.length > 0) {
      chunks.push({
        id: `${doc.id}-chunk-${index}`,
        documentId: doc.id,
        title: doc.title,
        category: doc.category,
        sourceName: doc.sourceName,
        sourceUrl: doc.sourceUrl,
        effectiveDate: doc.effectiveDate,
        districtId: doc.districtId,
        text: slice,
      });
    }
    if (end >= cleaned.length) break;
    start = Math.max(start + 1, end - overlap);
    index++;
  }
  return chunks;
}

function ensureChunksIndexed() {
  if (store.chunks.length > 0) return;
  for (const doc of store.documents) {
    if (doc.approved) {
      store.chunks.push(...chunkDocument(doc));
    }
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

function lexicalScore(query: string, text: string): number {
  const tokens = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;
  const hay = text.toLowerCase();
  let matches = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) matches++;
  }
  return matches / tokens.length;
}

async function embedText(ai: GoogleGenAI, text: string): Promise<number[] | undefined> {
  try {
    const res = await ai.models.embedContent({
      model: 'gemini-embedding-2',
      contents: text,
    });
    return res.embeddings?.[0]?.values;
  } catch {
    return undefined;
  }
}

async function retrieveHybridContext(
  query: string,
  filters?: { category?: string; districtId?: string }
) {
  ensureChunksIndexed();
  const candidates = store.chunks.filter((chunk) => {
    const doc = store.documents.find((d) => d.id === chunk.documentId);
    if (!doc || !doc.approved) return false;
    if (filters?.category && filters.category !== 'ALL' && chunk.category !== filters.category) return false;
    if (filters?.districtId && filters.districtId !== 'ALL' && chunk.districtId !== filters.districtId) {
      // Allow state-wide Bhopal/Indore policy docs too
      if (chunk.category !== 'PRICING' && chunk.category !== 'REGULATORY' && chunk.category !== 'CLINICAL') {
        return false;
      }
    }
    return true;
  });

  const ai = getGeminiClient();
  let queryVec: number[] | undefined;
  if (ai) {
    queryVec = await embedText(ai, query);
    // Lazily embed up to 6 unembedded chunks per query
    let embeddedNow = 0;
    for (const c of candidates) {
      if (!c.embedding && embeddedNow < 6) {
        c.embedding = await embedText(ai, `${c.title}\n${c.text}`);
        embeddedNow++;
      }
    }
  }

  const scored = candidates.map((c) => {
    const kw = lexicalScore(query, `${c.title} ${c.text} ${c.sourceName}`);
    const vec = queryVec && c.embedding ? Math.max(0, cosineSimilarity(queryVec, c.embedding)) : 0;
    const hybrid = queryVec && c.embedding ? 0.65 * vec + 0.35 * kw : kw;
    return { chunk: c, score: hybrid, semanticUsed: Boolean(queryVec && c.embedding) };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

const PHARMA_SYSTEM_INSTRUCTION = `You are the RouteRescue AI Pharmaceutical Knowledge Assistant for Madhya Pradesh, India.
STRICT SAFETY & ACCURACY RULES:
1. NEVER write or provide a medical prescription.
2. NEVER recommend changing a patient's dosage or frequency.
3. NEVER make therapeutic substitution decisions.
4. Clearly distinguish:
   - Identical composition products (same active ingredients, strength, and dosage form)
   - Different compositions (not equivalent)
5. Clearly distinguish pricing tiers: MRP, NPPA DPCO Ceiling Price, Retail Selling Price, and Distributor Purchase Price — always state pack size, source, and effective date when citing prices.
6. NEVER fabricate medicine prices, stock availability, hospitals, or regulatory circulars. Only cite facts present in the retrieved RAG context, structured medicine registry, or live Supply Agent stock output provided in the prompt.
7. If reliable information is not in the retrieved context, explicitly state that it is unavailable rather than guessing.
8. Include inline source citations like [Source: <Name>, <Effective Date>] for factual statements.`;

export function registerPharmaRagRoutes(router: Router) {
  router.get('/pharma/search', (req, res) => {
    const q = ((req.query.q as string) ?? '').trim().toLowerCase();
    const results = !q
      ? store.medicines
      : store.medicines.filter(
          (m) =>
            m.brandName.toLowerCase().includes(q) ||
            m.genericName.toLowerCase().includes(q) ||
            m.composition.toLowerCase().includes(q) ||
            m.manufacturer.toLowerCase().includes(q) ||
            m.therapeuticCategory.toLowerCase().includes(q)
        );
    res.json({ medicines: results });
  });

  router.post('/pharma/compare', (req, res) => {
    const { medicineIds } = req.body as { medicineIds: string[] };
    if (!Array.isArray(medicineIds) || medicineIds.length < 2) {
      return res.status(400).json({ error: 'Select at least two medicines to compare.' });
    }
    const selected = medicineIds
      .map((id) => store.getMedicineById(id))
      .filter((m): m is NonNullable<typeof m> => Boolean(m));

    if (selected.length < 2) {
      return res.status(404).json({ error: 'Selected medicines not found.' });
    }

    const base = selected[0];
    const comparisons = selected.slice(1).map((other) => {
      const identicalComposition =
        base.composition.toLowerCase() === other.composition.toLowerCase() &&
        base.strength.toLowerCase() === other.strength.toLowerCase() &&
        base.dosageForm.toLowerCase() === other.dosageForm.toLowerCase();
      const sameGeneric = base.genericName.toLowerCase() === other.genericName.toLowerCase();
      return {
        medicineA: base.brandName,
        medicineB: other.brandName,
        equivalenceClass: identicalComposition
          ? 'IDENTICAL_COMPOSITION'
          : sameGeneric
            ? 'SAME_GENERIC_DIFFERENT_STRENGTH_OR_FORM'
            : 'NOT_EQUIVALENT',
        note: identicalComposition
          ? 'Identical active ingredient composition, strength, and dosage form. Dispensing substitution still requires prescriber/regulatory compliance.'
          : 'Different active composition or dosage form — NOT equivalent. Do not substitute.',
        mrpDifferenceInr: Number((other.mrpInr - base.mrpInr).toFixed(2)),
      };
    });

    res.json({ medicines: selected, comparisons });
  });

  router.get('/pharma/prices', (req, res) => {
    const q = ((req.query.q as string) ?? '').trim().toLowerCase();
    const list = store.medicines
      .filter(
        (m) =>
          !q ||
          m.brandName.toLowerCase().includes(q) ||
          m.genericName.toLowerCase().includes(q)
      )
      .map((m) => ({
        id: m.id,
        brandName: m.brandName,
        genericName: m.genericName,
        strength: m.strength,
        packSize: m.packSize,
        nppaCeilingPriceInr: m.nppaCeilingPriceInr,
        mrpInr: m.mrpInr,
        retailSellingPriceInr: m.retailSellingPriceInr,
        distributorPurchasePriceInr: m.distributorPurchasePriceInr,
        priceEffectiveDate: m.priceEffectiveDate,
        priceSource: m.priceSource,
        dataStatus: m.dataStatus,
      }));
    res.json({ prices: list });
  });

  router.get('/pharma/manufacturers', (_req, res) => {
    const mpPlants = store.organizations.filter((o) => o.level === 'MANUFACTURER');
    const brandManufacturers = Array.from(new Set(store.medicines.map((m) => m.manufacturer))).map(
      (name) => ({
        name,
        productsCount: store.medicines.filter((m) => m.manufacturer === name).length,
        coldChainProducts: store.medicines.filter((m) => m.manufacturer === name && m.coldChainRequired).length,
        source: 'RouteRescue Verified Brand & Invest MP Registry',
      })
    );
    res.json({ mpManufacturingUnits: mpPlants, brandManufacturers });
  });

  router.get('/pharma/news', (req, res) => {
    const { districtId } = req.query as { districtId?: string };
    const items =
      districtId && districtId !== 'ALL'
        ? store.news.filter((n) => n.districtId === districtId)
        : store.news;
    res.json({ news: items });
  });

  router.get('/pharma/facilities', (req, res) => {
    const { districtId } = req.query as { districtId?: string };
    const facilities =
      districtId && districtId !== 'ALL'
        ? store.facilities.filter((f) => f.districtId === districtId)
        : store.facilities;
    res.json({ facilities });
  });

  router.get('/pharma/documents', (_req, res) => {
    res.json({
      documents: store.documents.map((d) => ({
        id: d.id,
        title: d.title,
        category: d.category,
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        effectiveDate: d.effectiveDate,
        districtId: d.districtId,
        approved: d.approved,
        dataStatus: d.dataStatus,
        createdAt: d.createdAt,
        chunkCount: chunkDocument(d).length,
      })),
    });
  });

  router.post('/pharma/documents/ingest', async (req: RequestWithAuth, res) => {
    try {
      const { title, category, sourceName, sourceUrl, effectiveDate, districtId, content, approved } =
        req.body as {
          title: string;
          category: PharmaDocument['category'];
          sourceName: string;
          sourceUrl?: string;
          effectiveDate?: string;
          districtId?: string;
          content: string;
          approved?: boolean;
        };

      if (!title || !content || content.trim().length < 20) {
        return res.status(400).json({ error: 'Document title and at least 20 characters of text content are required.' });
      }

      const doc: PharmaDocument = {
        id: `doc-${uuidv4().slice(0, 8)}`,
        title: title.trim(),
        category: category || 'REGULATORY',
        sourceName: sourceName?.trim() || 'Authorized MP Operator Upload',
        sourceUrl: sourceUrl?.trim() || 'internal://approved-upload',
        effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
        districtId: districtId || 'mp-bhopal',
        approved: approved !== false,
        content: cleanText(content),
        dataStatus: 'VERIFIED',
        createdAt: new Date().toISOString(),
      };

      store.documents.unshift(doc);
      ensureChunksIndexed();
      const newChunks = chunkDocument(doc);
      const ai = getGeminiClient();
      if (ai) {
        for (const c of newChunks.slice(0, 8)) {
          c.embedding = await embedText(ai, `${c.title}\n${c.text}`);
        }
      }
      store.chunks.unshift(...newChunks);

      store.addAuditLog({
        actorId: req.authContext?.email ?? req.authContext?.uid ?? 'operator',
        actorRole: req.authContext?.role ?? 'STATE_ADMIN',
        action: 'PHARMA_DOCUMENT_INGESTED',
        entityType: 'PharmaDocument',
        entityId: doc.id,
        details: `Ingested "${doc.title}" (${newChunks.length} chunks indexed).`,
      });

      res.status(201).json({ document: doc, chunksIndexed: newChunks.length });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : 'Document ingestion failed.' });
    }
  });

  router.post('/pharma/chat', async (req, res) => {
    try {
      const { message, category, districtId } = req.body as {
        message: string;
        category?: string;
        districtId?: string;
      };
      if (!message || !message.trim()) {
        return res.status(400).json({ error: 'Question message is required.' });
      }

      const retrieved = await retrieveHybridContext(message, { category, districtId });

      // Detect if user asks about live stock availability -> query Supply Agent directly
      const stockKeywords = ['stock', 'available', 'availability', 'inventory', 'shortage', 'sehore', 'bhopal', 'indore', 'rewa', 'jabalpur', 'gwalior', 'chhindwara'];
      const asksAboutStock = stockKeywords.some((kw) => message.toLowerCase().includes(kw));

      let liveStockContext: unknown[] = [];
      if (asksAboutStock) {
        for (const med of store.medicines) {
          if (
            message.toLowerCase().includes(med.brandName.toLowerCase().split(' ')[0]) ||
            message.toLowerCase().includes(med.genericName.toLowerCase().split(' ')[0])
          ) {
            const stock = queryLiveStockForMedicine(med.brandName);
            liveStockContext.push(
              ...stock.records.map((r) => ({
                nodeName: r.nodeName,
                districtId: r.districtId,
                medicineBrand: r.medicineBrand,
                availableQty: r.availableQty,
                reservedQty: r.reservedQty,
                incomingQty: r.incomingQty,
                expiryDate: r.expiryDate,
                dataStatus: r.dataStatus,
                updatedAt: r.updatedAt,
              }))
            );
          }
        }
      }

      // Structured medicine catalog context
      const matchedMeds = store.medicines.filter(
        (m) =>
          message.toLowerCase().includes(m.brandName.toLowerCase().split(' ')[0]) ||
          message.toLowerCase().includes(m.genericName.toLowerCase().split(' ')[0]) ||
          message.toLowerCase().includes('price') ||
          message.toLowerCase().includes('compare')
      );

      const citations = retrieved.map((r) => ({
        documentId: r.chunk.documentId,
        title: r.chunk.title,
        sourceName: r.chunk.sourceName,
        sourceUrl: r.chunk.sourceUrl,
        effectiveDate: r.chunk.effectiveDate,
        score: Number(r.score.toFixed(3)),
        retrievalMode: r.semanticUsed ? 'HYBRID_VECTOR_KEYWORD' : 'KEYWORD_BM25',
      }));

      const contextBlock = [
        'RETRIEVED APPROVED RAG CHUNKS:',
        ...retrieved.map(
          (r, i) =>
            `[${i + 1}] ${r.chunk.title} (Source: ${r.chunk.sourceName}, Effective: ${r.chunk.effectiveDate}, URL: ${r.chunk.sourceUrl})\n${r.chunk.text}`
        ),
        matchedMeds.length > 0
          ? `\nVERIFIED MEDICINE & PRICING REGISTRY:\n${JSON.stringify(matchedMeds, null, 2)}`
          : '',
        liveStockContext.length > 0
          ? `\nLIVE SUPPLY AGENT STOCK QUERY (Data Status: SIMULATED DEMO INVENTORY):\n${JSON.stringify(liveStockContext, null, 2)}`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');

      const ai = getGeminiClient();
      if (!ai) {
        // Transparent grounded fallback when API key is not configured
        const fallbackSummary =
          retrieved.length > 0
            ? retrieved
                .slice(0, 3)
                .map((r) => `• ${r.chunk.title} (${r.chunk.sourceName}, ${r.chunk.effectiveDate}): ${r.chunk.text}`)
                .join('\n\n')
            : 'No matching documents found in the local pharmaceutical index.';
        return res.json({
          answer: `${fallbackSummary}${
            liveStockContext.length > 0
              ? `\n\nLive Supply Agent Stock Snapshot (SIMULATED):\n${JSON.stringify(liveStockContext, null, 2)}`
              : ''
          }\n\nNote: Grounded extractive summary returned (Gemini LLM provider unavailable or key not set).`,
          citations,
          liveStockQueried: liveStockContext.length > 0,
          modelUsed: 'EXTRACTIVE_RAG_FALLBACK',
        });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Question: ${message}\n\n${contextBlock}`,
        config: {
          systemInstruction: PHARMA_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      res.json({
        answer: response.text ?? 'No response generated from knowledge assistant.',
        citations,
        liveStockQueried: liveStockContext.length > 0,
        liveStockCount: liveStockContext.length,
        modelUsed: 'gemini-4-hydrogen',
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Knowledge assistant query failed.',
      });
    }
  });
}
