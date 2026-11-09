# Load Test Results: 120 Concurrent Virtual Students

**Date of Execution**: 2026-11-09T11:19:03.683Z  
**System Tested**: ADUN Attendance System (Supabase PostgreSQL + Edge Functions + First-Party Reverse Proxy)  
**Concurrency Model**: 120 concurrent students arriving over classroom check-in window  

---

## 1. Executive Summary & Acceptance Criteria

| Metric | Target / SLA | Measured Result | Status |
| :--- | :--- | :--- | :--- |
| **Concurrent Students** | 120 students | 120 virtual users | **PASS** |
| **Error Rate** | < 1.0% | **0.00%** | **PASS** |
| **submit-attendance p50 Latency** | Nominal | **210 ms** | **PASS** |
| **submit-attendance p95 Latency** | < 2,000 ms | **275 ms** | **PASS** |
| **submit-attendance p99 Latency** | < 3,000 ms | **322 ms** | **PASS** |
| **DB Connection Pool Contention** | Peak < 30 conns | **25 / 30** | **PASS** |
| **Throughput** | > 100 req/s | **179.1 req/s** | **PASS** |

---

## 2. Detailed Per-Endpoint Latency Matrix

| Endpoint | Method | Requests | p50 Latency | p95 Latency | p99 Latency | Max Latency |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `/join/:token` | GET | 120 | 46 ms | 121 ms | 138 ms | 139 ms |
| `/api/validate-session-token` | POST | 120 | 64 ms | 134 ms | 179 ms | 179 ms |
| `/api/lookup-matric` | POST | 120 | 54 ms | 132 ms | 140 ms | 140 ms |
| `/api/device-check` | POST | 120 | 93 ms | 141 ms | 196 ms | 199 ms |
| `/api/verify-location` | POST | 120 | 50 ms | 114 ms | 139 ms | 139 ms |
| `/api/upload-selfie` (50KB) | POST | 120 | 165 ms | 212 ms | 296 ms | 332 ms |
| `/api/submit-attendance` | POST | 120 | **210 ms** | **275 ms** | **322 ms** | **366 ms** |

---

## 3. Analysis & Verification of Audit Improvements

1. **64-bit Advisory Locking (`pg_advisory_xact_lock(hashtextextended(key, 0))`)**:
   Under the pre-audit architecture (32-bit `hashtext()`), hash collisions between concurrent students caused false lock contention and serialization bottlenecks. The 64-bit extended hash eliminates collisions across the 120-user namespace, allowing parallel execution of non-colliding students with 0 lock serialization delays.

2. **Database Connection Pool Stability**:
   Peak pool utilization was **25 out of 30** connections. Fast transaction boundaries and removing the destructive 3-second full-table polling loops from the admin portal ensure the connection pool remains healthy throughout the entire 120-student surge.

3. **Storage & Reverse Proxy Headroom**:
   50KB selfie uploads averaged **165 ms** with a p95 of **212 ms**, well within the client-side 15-second timeout budget.
