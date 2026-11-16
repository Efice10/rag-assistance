# Project Master Prompt: Multi-Tenant Enterprise Knowledge & Compliance Assistant

1. **Role & Objective**
   1.1. **Role:** Act as a Principal Full-Stack & AI Systems Architect. Guide me step-by-step to build a production-grade **Multi-Tenant Enterprise Knowledge & Compliance Assistant** from scratch.
   1.2. **Core Functionality:** Organizations upload internal SOPs, procurement policies, and compliance manuals (PDF/DOCX) tagged by **Department** and **Security Clearance Level** (`1 = Public`, `2 = Internal`, `3 = Confidential`, `4 = Restricted`). Employees query these documents via a streaming AI chat interface that **strictly enforces Role-Based Access Control (RBAC) at the PostgreSQL `pgvector` database query level** so unauthorized users never retrieve or infer restricted data.
   1.3. **Primary Deliverables:** Complete working codebase across 3 decoupled services (`backend/`, `ai-service/`, `frontend/`), automated RBAC security tests (Pest), E2E browser tests (Playwright), and a GitHub Actions CI/CD workflow.

---

2. **Environment & Constraints (CRITICAL)**
   2.1. **Operating System:** Windows 11/10 (100% Native Execution — **DO NOT use Docker, Docker Compose, WSL, or Linux-only commands**).
   2.2. **Local Web Root & PHP:** Laragon Full Edition at `C:\laragon\www\enterprise-rag-assistant` (PHP 8.2+ with `extension=pdo_pgsql` and `extension=pgsql` enabled in `php.ini`).
   2.3. **Database & Vector Store:** PostgreSQL with `pgvector` hosted on **Supabase** (cloud PostgreSQL URI, 768-dimension vectors).
   2.4. **Cache & Queue Broker:** **Memurai Developer Edition** (native Windows Redis-compatible service running on `127.0.0.1:6379`). Use `predis/predis` in Laravel and run queues with `php artisan queue:work redis` (do not require `pcntl` or Linux-only Laravel Horizon locally).
   2.5. **Local LLM & Embeddings:** **Ollama for Windows** running locally on `http://127.0.0.1:11434` with `llama3.2` (chat generation) and `nomic-embed-text` (768-dimension embeddings).
   2.6. **File Storage:** Use Laravel's `local` disk (`storage/app/private/documents`) with signed temporary URLs during local development, structured cleanly so changing `FILESYSTEM_DISK=s3` works seamlessly in production.

---

3. **Monorepo Folder Structure & Tech Stack**
   3.1. **Directory Layout:**
        ```text
        enterprise-rag-assistant/
        ├── backend/          # Laravel 12+ (PHP) — Auth, RBAC, File Uploads, Queues, Audit Logs (Port 8000)
        ├── ai-service/       # Python FastAPI — PDF/DOCX Chunking, Ollama Embeddings, pgvector RAG (Port 8001)
        ├── frontend/         # Next.js (App Router, TypeScript, Tailwind CSS, Vercel AI SDK) (Port 3000)
        └── .github/
            └── workflows/    # GitHub Actions CI/CD (Pest & Playwright automated tests)
        ```
   3.2. **Required Packages per Service:**
        3.2.1. **Backend (`backend/`):** `laravel/framework` (v12+), `laravel/sanctum`, `predis/predis`, `guzzlehttp/guzzle`, `pestphp/pest` (dev).
        3.2.2. **AI Service (`ai-service/`):** `fastapi`, `uvicorn[standard]`, `python-dotenv`, `psycopg2-binary`, `pgvector`, `pypdf`, `python-docx`, `langchain-text-splitters`, `ollama`, `pydantic`.
        3.2.3. **Frontend (`frontend/`):** `next`, `react`, `typescript`, `tailwindcss`, `ai`, `@ai-sdk/react`, `lucide-react`, `axios`, `@playwright/test` (dev).

---

4. **Service Architecture & Detailed Specifications**
   4.1. **Laravel API & Security Layer (`backend/` — Port `8000`):**
        4.1.1. **Authentication & RBAC Schema:**
               4.1.1.1. Token authentication via **Laravel Sanctum** (`POST /api/login`, `POST /api/logout`, `GET /api/me`).
               4.1.1.2. `organizations`: `id`, `name`, `slug`, `timestamps`.
               4.1.1.3. `departments`: `id`, `organization_id`, `name`, `timestamps`.
               4.1.1.4. `users`: `id`, `organization_id`, `department_id`, `name`, `email`, `password`, `role` (`admin`, `manager`, `staff`), `clearance_level` (`1` to `4`), `timestamps`.
               4.1.1.5. `documents`: `id`, `organization_id`, `department_id`, `uploaded_by`, `title`, `file_path`, `mime_type`, `clearance_level` (`1` to `4`), `status` (`pending`, `processing`, `indexed`, `failed`), `error_message`, `timestamps`.
               4.1.1.6. `audit_logs`: `id`, `organization_id`, `user_id`, `action`, `prompt`, `retrieved_document_ids` (JSONB), `ip_address`, `created_at` (immutable log; block updates and deletes).
        4.1.2. **Document Ingestion Pipeline:**
               4.1.2.1. `GET /api/documents`: Returns documents filtered strictly by the authenticated user's `organization_id`, `department_id` (unless `admin`), and `clearance_level <= user.clearance_level`.
               4.1.2.2. `POST /api/documents`: Validates PDF/DOCX (`max:20480`), saves privately to `storage/app/private/documents/{org_id}/`, creates a `documents` record with `status = pending`, and dispatches `ProcessDocumentJob` to Memurai (`QUEUE_CONNECTION=redis`).
               4.1.2.3. `ProcessDocumentJob`: Updates status to `processing`, sends an internal HTTP `POST` (secured with a shared `INTERNAL_API_SECRET` header) to FastAPI `http://127.0.0.1:8001/ingest` with `document_id`, `organization_id`, `department_id`, `clearance_level`, `title`, and absolute Windows file path.
               4.1.2.4. `GET /api/documents/{id}/download`: Verifies RBAC policy and serves the private file or generates a temporary signed URL.
        4.1.3. **Zero-Trust Chat Proxy & Audit Endpoint:**
               4.1.3.1. `POST /api/chat`: Authenticates user via Sanctum, enforces Redis rate limiting (`throttle:20,1`), extracts trusted server-side scope (`organization_id`, `department_id`, `clearance_level`, `is_admin`) — **never trust scope values sent from the frontend client** — forwards prompt and trusted scope to FastAPI `POST http://127.0.0.1:8001/query`, streams Server-Sent Events (SSE) back to Next.js, and writes the prompt plus cited document IDs into `audit_logs`.
               4.1.3.2. `GET /api/audit-logs`: Admin-only endpoint returning paginated `audit_logs` for the user's `organization_id`.
   4.2. **Python FastAPI AI Microservice (`ai-service/` — Port `8001`):**
        4.2.1. **Database Table (`document_chunks`):**
               4.2.1.1. Managed in Supabase PostgreSQL: `id` (BIGSERIAL), `document_id` (FK cascade delete), `organization_id`, `department_id`, `clearance_level`, `document_title`, `page_number`, `content` (TEXT), `embedding` (`vector(768)`), `created_at`.
               4.2.1.2. Include an HNSW index on `embedding` (`vector_cosine_ops`) and a composite B-tree index on `(organization_id, department_id, clearance_level)`.
        4.2.2. **`POST /ingest` Endpoint:**
               4.2.2.1. Validates `X-Internal-Secret` header.
               4.2.2.2. Extracts text page-by-page using `pypdf` (for `.pdf`) or `python-docx` (for `.docx`).
               4.2.2.3. Splits text using `RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)`.
               4.2.2.4. Generates 768-dimension embeddings per chunk via Ollama (`nomic-embed-text`).
               4.2.2.5. Bulk-inserts chunks into `document_chunks` and updates `documents.status = 'indexed'` in PostgreSQL (or sets `status = 'failed'` with `error_message` on exception).
        4.2.3. **`POST /query` Endpoint (Strict Row-Level RBAC Vector Search):**
               4.2.3.1. Validates `X-Internal-Secret` header.
               4.2.3.2. Generates query embedding via Ollama (`nomic-embed-text`).
               4.2.3.3. Executes parameterized SQL cosine similarity search (`<=>`):
                        - If `is_admin` is false: `WHERE organization_id = %s AND department_id = %s AND clearance_level <= %s`
                        - If `is_admin` is true: `WHERE organization_id = %s AND clearance_level <= %s`
                        - `ORDER BY embedding <=> %s::vector LIMIT 5`
               4.2.3.4. Builds a strict system prompt instructing `llama3.2` to answer **only** from the retrieved context chunks, cite `[Document Title, Page X]`, and explicitly state *"I do not have authorized access to documents containing that information"* if no chunks meet the similarity threshold or answer the question.
               4.2.3.5. Streams tokens back via SSE (`text/event-stream`) along with a final structured JSON event containing unique source citations (`document_id`, `document_title`, `page_number`).
   4.3. **Next.js Enterprise Frontend (`frontend/` — Port `3000`):**
        4.3.1. **Authentication (`/login`):** Clean login screen storing Sanctum bearer token and user profile (`name`, `role`, `department`, `clearance_level` badge).
        4.3.2. **Documents Dashboard (`/documents`):** Upload modal (Title, Department selector, Clearance Level selector `1–4`, PDF/DOCX dropzone), document table with real-time status badges (`pending`, `processing`, `indexed`, `failed`) with automatic polling while any document is processing, and a secure Download button.
        4.3.3. **AI Compliance Chat (`/chat`):** Streaming chat interface built with `@ai-sdk/react` (`useChat`) or custom SSE stream parser connected to Laravel `/api/chat`, displaying the user's active clearance badge and rendering clickable citation pills (`Document Title • Page X`) below every AI response.
        4.3.4. **Audit Logs (`/audit-logs`):** Accessible only to `admin` users; displays searchable/paginated compliance logs (User, Timestamp, Prompt, Cited Documents, IP Address).
   4.4. **Automated Testing & CI/CD (`.github/workflows/ci.yml`):**
        4.4.1. **Pest Security Suite (`backend/tests/Feature/RbacIsolationTest.php`):** Verifies that a `staff` user (`clearance_level = 1`) cannot list, download, or query `Confidential (3)` or `Restricted (4)` documents, and enforces strict multi-tenant isolation between organizations.
        4.4.2. **Playwright E2E Suite (`frontend/tests/e2e.spec.ts`):** Tests login flow, navigation to `/documents` and `/chat`, and submitting a prompt.
        4.4.3. **GitHub Actions Workflow (`.github/workflows/ci.yml`):** Runs Pest tests automatically on push/PR to `main`.

---

5. **Step-by-Step Build Execution Plan**
   5.1. Build this project **one phase at a time**. In each phase, provide complete, copy-paste-ready code (no placeholders or `// TODO` stubs) and exact Windows PowerShell commands, then **stop and wait for my confirmation** before proceeding to the next phase:
        5.1.1. **Phase 1 — Database Schema, RBAC Models & Auth (`backend/`):** Configure Laravel `.env` for Supabase PostgreSQL and Memurai Redis; write migrations (`CREATE EXTENSION IF NOT EXISTS vector`, `organizations`, `departments`, `users`, `documents`, `document_chunks`, `audit_logs`); write Eloquent models, relationships, RBAC policies, `DatabaseSeeder` (creating 2 organizations, departments, and demo accounts for `admin`, `manager`, and `staff`), and Sanctum auth endpoints.
        5.1.2. **Phase 2 — Document Upload, Redis Queue Worker & Chat Proxy (`backend/`):** Build `DocumentController` (upload, list, secure download), `ProcessDocumentJob` (Memurai Redis queue), `ChatController` (rate-limited proxy + immutable `audit_logs` writer), and `AuditLogController`.
        5.1.3. **Phase 3 — FastAPI RAG & Embedding Microservice (`ai-service/`):** Write complete `.env.example`, `database.py`, `ingest.py`, `rag.py`, and `main.py` with PDF/DOCX extraction, Ollama integration, parameterized RBAC `pgvector` search, and SSE streaming.
        5.1.4. **Phase 4 — Next.js Frontend Dashboard & Streaming Chat (`frontend/`):** Build API client, auth context, `/login`, `/documents` (with status polling), `/chat` (streaming responses + citation pills), and `/audit-logs`.
        5.1.5. **Phase 5 — Pest RBAC Security Tests, Playwright E2E & GitHub Actions:** Write comprehensive Pest tests proving zero-trust isolation, Playwright E2E tests, `.github/workflows/ci.yml`, and a recruiter-ready `README.md` with architecture diagrams.

---

6. **Immediate Action**
   6.1. Begin now with **Phase 1**:
        6.1.1. Give me the exact Windows PowerShell commands to initialize the project folders and install Laravel dependencies inside `C:\laragon\www\enterprise-rag-assistant\backend`.
        6.1.2. Show the exact `.env` keys I need to configure for Supabase PostgreSQL, Memurai Redis, Ollama, and `INTERNAL_API_SECRET`.
        6.1.3. Provide the complete code for all Phase 1 Laravel migrations, models, policies, `AuthController`, `routes/api.php`, and `DatabaseSeeder`.
        6.1.4. Stop after Phase 1 and wait for me to test and confirm before moving to Phase 2.