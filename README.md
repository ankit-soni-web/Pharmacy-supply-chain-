# RouteRescue AI

Integrated AI-powered pharmaceutical supply-chain intelligence platform built exclusively for **Madhya Pradesh, India**, connecting Manufacturers, C&F Agents, Super-Stockists, Wholesalers, Local Distributors, Retail Pharmacies, Hospital Pharmacies, and State Administrators.

## Architecture & Five Integrated Agents

1. **Route & Logistics Agent** (`/api/routes/*`) — MP corridor routing (OSRM with deterministic geodesic fallback), interactive Leaflet map, vehicle capacity & 2°C–8°C cold-chain verification, alternative corridor analysis, and highway disruption alerts.
2. **Supply Management Agent** (`/api/supply/*`) — Multi-tier MP inventory visibility, batch expiry tracking, 7-day demand forecasting, shortage/excess/expiry scanning, and strictly human-gated stock redistribution & replenishment approvals.
3. **Reporting & Analytics Agent** (`/api/reports/*`) — Database-computed state, district, and 7-tier distribution level KPIs, Recharts trend & comparative charts, bottlenecks, and CSV/JSON exports.
4. **Alert, Root-Cause & Resolution Agent** (`/api/alerts/*`, `/api/incidents/*`) — Cross-agent incident detection via central Event Bus (`/api/events/stream`), evidence-backed root-cause analysis (`CONFIRMED` / `PROBABLE` / `SUSPECTED`), and resolution workflows.
5. **LLM + RAG Pharmaceutical Knowledge Assistant** (`/api/pharma/*`) — Server-side Gemini + vector-grounded RAG knowledge base covering MP FDA guidelines, NPPA pricing, ABDM HFR, cold-chain protocols, and live stock/disruption lookups.

### Cross-Cutting Capabilities
- **7-Tier Quantitative Matrix & Charts**: Per-level capacity, stock, reserved/in/out, shortages, incidents, fulfilment %, and on-time delivery %.
- **Tier-Specific Login & Full MP Address Verification** (`/api/levels/login-profile`): Street-level address, MP PIN (`45xxxx–48xxxx`) validation, and isolated PII storage in Firestore (`users/{uid}/private/info`).
- **Multi-Outcome Predictive Solution** (`/api/predictive/evaluate`): Evaluates 4 operational trajectories side-by-side before presenting a human-gated Predictive Solution.
- **1-Hop Rapid-Reach & Contact Privacy Guard** (`/api/contacts/scoped`, `/api/contacts/fast-reach`): Unlocks immediate SLA escalation exclusively to 1-hop adjacent supply partners while redacting contacts beyond scope (`REDACTED_BEYOND_SCOPE`).

## Tech Stack
- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS v4, Recharts, Leaflet
- **Backend**: Node.js, Express (`server.ts`), Server-Sent Events (SSE), `@google/genai`
- **Database & Auth**: Firebase Authentication & Cloud Firestore (`firebase-blueprint.json`, `firestore.rules`)

## Getting Started

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure environment variables**
   Copy `.env.example` to `.env` and fill in your credentials:
   ```env
   GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
   APP_URL="http://localhost:3000"
   ```

3. **Run development server (port 3000)**
   ```bash
   npm run dev
   ```

4. **Type-check & build for production**
   ```bash
   npm run lint
   npm run build
   npm start
   ```
