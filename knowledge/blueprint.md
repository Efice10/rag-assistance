# Complete Project Blueprint & Windows Installation Guide (No Docker)

1. **Project Overview**
   1.1. **Project Title:** Multi-Tenant Enterprise Knowledge & Compliance Assistant
   1.2. **Core Objective:** Build an internal document Q&A and compliance audit platform where organizations upload SOPs, policies, and manuals (PDF/DOCX) tagged by Department and Security Clearance Level, and employees query them via a streaming AI chat interface that strictly enforces Role-Based Access Control (RBAC) at the database vector-search level.
   1.3. **Environment Constraint:** 100% Native Windows execution (Laragon + Memurai + Ollama + Supabase). **No Docker, WSL, or virtual machines required.**

---

2. **System Software & Cloud Services to Install**
   2.1. **Laragon (Full Edition — PHP 8.2+ & Composer):** Local PHP runtime and web root (`C:\laragon\www`). *(Already installed)*
   2.2. **Memurai Developer Edition (Free):** Native Windows Redis-compatible service for background queues and rate limiting (`127.0.0.1:6379`).
        - Download: `https://www.memurai.com/get-memurai`
   2.3. **Ollama for Windows:** Local AI inference engine for running LLMs and embedding models with zero API costs (`http://127.0.0.1:11434`).
        - Download: `https://ollama.com/download/windows`
   2.4. **Python 3.11 or 3.12 (64-bit):** Runs the FastAPI AI microservice *(Check "Add Python to PATH" during installation)*.
        - Download: `https://www.python.org/downloads/windows/`
   2.5. **Node.js (v20 LTS or v22 LTS):** Runs the Next.js frontend and Playwright automated tests.
        - Download: `https://nodejs.org`
   2.6. **Supabase (Free Tier Account):** Managed cloud PostgreSQL database with `pgvector` pre-installed.
        - Setup: `https://supabase.com`
   2.7. **Git for Windows:** Version control and GitHub Actions CI/CD integration. *(Already installed)*

---

3. **Cloud Database & Local AI Model Setup**
   3.1. **Configure Supabase PostgreSQL + `pgvector`:**
        3.1.1. Create a free project on `https://supabase.com`.
        3.1.2. Open the **SQL Editor** in the Supabase dashboard and execute:
        ```sql
        CREATE EXTENSION IF NOT EXISTS vector;
        ```
        3.1.3. Go to **Settings > Database > Connection string > URI** and copy your PostgreSQL connection URI.
   3.2. **Download Local Ollama Models:**
        3.2.1. Open PowerShell after installing Ollama and run:
        ```powershell
        ollama pull nomic-embed-text
        ollama pull llama3.2
        ```
        3.2.2. `nomic-embed-text` generates 768-dimension vector embeddings.
        3.2.3. `llama3.2` generates grounded answers with source citations locally.

---

4. **Monorepo Folder Structure**
   4.1. Initialize the root directory inside `C:\laragon\www`:
        ```powershell
        mkdir C:\laragon\www\enterprise-rag-assistant
        cd C:\laragon\www\enterprise-rag-assistant
        mkdir .github\workflows
        ```
   4.2. Final directory layout:
        ```text
        enterprise-rag-assistant/
        ├── backend/          # Laravel 12+ (PHP) — Auth, RBAC, Uploads, Queues, Audit Logs (Port 8000)
        ├── ai-service/       # Python FastAPI — PDF/DOCX Chunking, Ollama, pgvector RAG (Port 8001)
        ├── frontend/         # Next.js (App Router, TypeScript, Tailwind, Vercel AI SDK) (Port 3000)
        └── .github/
            └── workflows/    # GitHub Actions CI/CD (Pest & Playwright automated tests)
        ```

---

5. **Backend Installation & Dependencies (`backend/` — PHP & Laravel)**
   5.1. **Enable PostgreSQL Extensions in Laragon:**
        5.1.1. Open Laragon → **Menu → PHP → php.ini**.
        5.1.2. Remove the leading `;` from these two lines and save:
        ```ini
        extension=pdo_pgsql
        extension=pgsql
        ```
   5.2. **Install Laravel & Composer Packages:**
        ```powershell
        cd C:\laragon\www\enterprise-rag-assistant
        composer create-project laravel/laravel backend
        cd backend
        php artisan install:api
        composer require predis/predis
        composer require pestphp/pest --dev --with-all-dependencies
        php artisan pest:install
        ```
   5.3. **Backend Package Breakdown:**
        5.3.1. `laravel/framework` (v12+): Core API, Eloquent ORM, RBAC policies, and queue dispatcher.
        5.3.2. `laravel/sanctum`: Token-based API authentication for Next.js.
        5.3.3. `predis/predis`: Pure-PHP Redis client connecting Laravel to Memurai on Windows without C++ DLL compilation.
        5.3.4. `guzzlehttp/guzzle`: Built-in HTTP client for dispatching document ingestion and chat requests to FastAPI.
        5.3.5. `pestphp/pest` *(dev)*: Automated unit and RBAC security isolation testing.

---

6. **AI Microservice Installation & Dependencies (`ai-service/` — Python)**
   6.1. **Create Virtual Environment & Install Packages:**
        ```powershell
        cd C:\laragon\www\enterprise-rag-assistant
        mkdir ai-service
        cd ai-service
        python -m venv venv
        .\venv\Scripts\activate
        pip install fastapi "uvicorn[standard]" python-dotenv psycopg2-binary pgvector pypdf python-docx langchain-text-splitters ollama pydantic
        pip freeze > requirements.txt
        ```
   6.2. **Python Package Breakdown:**
        6.2.1. `fastapi`: High-performance async Python REST & Server-Sent Events (SSE) API framework.
        6.2.2. `uvicorn[standard]`: ASGI server running FastAPI on Port `8001`.
        6.2.3. `python-dotenv`: Loads Supabase DB URI and Ollama URL from `.env`.
        6.2.4. `psycopg2-binary`: PostgreSQL database adapter for parameterized SQL queries.
        6.2.5. `pgvector`: Vector type integration for PostgreSQL similarity search (`<=>`).
        6.2.6. `pypdf`: Extracts raw text and exact page numbers from PDFs.
        6.2.7. `python-docx`: Extracts text from `.docx` documents.
        6.2.8. `langchain-text-splitters`: Splits documents into overlapping chunks (`chunk_size=800`, `chunk_overlap=150`).
        6.2.9. `ollama`: Official Python client for local embeddings and streaming chat.
        6.2.10. `pydantic`: Request/response schema validation.

---

7. **Frontend Installation & Dependencies (`frontend/` — Next.js)**
   7.1. **Scaffold Next.js & Install Packages:**
        ```powershell
        cd C:\laragon\www\enterprise-rag-assistant
        npx create-next-app@latest frontend --typescript --tailwind --eslint --app --no-src-dir
        cd frontend
        npm install ai @ai-sdk/react lucide-react axios
        npm install -D @playwright/test
        npx playwright install chromium
        ```
   7.2. **Frontend Package Breakdown:**
        7.2.1. `next` / `react` / `typescript`: Core App Router frontend framework with strict typing.
        7.2.2. `tailwindcss`: Utility-first CSS framework for the enterprise dashboard UI.
        7.2.3. `ai` & `@ai-sdk/react`: Vercel AI SDK (`useChat`) for real-time token streaming and citation rendering.
        7.2.4. `lucide-react`: Icons for document status, clearance badges, and audit logs.
        7.2.5. `axios`: HTTP client for Laravel authentication, file uploads, and audit endpoints.
        7.2.6. `@playwright/test` *(dev)*: End-to-end automated browser testing for CI/CD.

---

8. **Pre-Coding Environment Verification Commands**
   8.1. Run all 5 commands in PowerShell to confirm every tool is active:
        ```powershell
        php -m | findstr pgsql       # Expected: pdo_pgsql and pgsql
        memurai-cli ping             # Expected: PONG
        ollama list                  # Expected: llama3.2 and nomic-embed-text
        python --version             # Expected: Python 3.11.x or 3.12.x
        node -v                      # Expected: v20.x.x or v22.x.x
        ```

---

9. **Complete System Architecture & Master Prompt for Claude**
   9.1. Copy and paste the instructions below into Claude to generate the codebase phase by phase:

   > **Role & Objective:** Act as a Principal Full-Stack & AI Systems Architect. Help me build a production-grade **Multi-Tenant Enterprise Knowledge & Compliance Assistant** from scratch. Organizations upload internal SOPs, procurement policies, and compliance manuals (PDF/DOCX) tagged by **Department** and **Security Clearance Level** (`1 = Public`, `2 = Internal`, `3 = Confidential`, `4 = Restricted`). Employees query documents via a streaming AI chat interface that **strictly enforces RBAC at the PostgreSQL `pgvector` query level** so unauthorized users never retrieve or infer restricted data.
   >
   > **Environment Constraints:**
   > 1. Native Windows execution only (Laragon at `C:\laragon\www\enterprise-rag-assistant`). **Do not use Docker or WSL.**
   > 2. Database: Supabase PostgreSQL with `pgvector` enabled.
   > 3. Redis/Queue: Memurai on `127.0.0.1:6379` using `predis/predis` and `php artisan queue:work redis`.
   > 4. AI Engine: Local Ollama on `http://127.0.0.1:11434` (`llama3.2` + `nomic-embed-text`, 768 dimensions).
   > 5. File Storage: Laravel `local` disk (`storage/app/private/documents`) with signed URLs, structured so switching `FILESYSTEM_DISK=s3` works seamlessly in production.
   >
   > **Service Specifications:**
   > 1. **Laravel (`backend/`, Port 8000):**
   >    - Sanctum API auth + RBAC schema (`organizations`, `departments`, `users`, `roles`: `admin`/`manager`/`staff`, `documents`, `audit_logs`).
   >    - `POST /api/documents`: Validates PDF/DOCX, saves privately, sets `status = pending`, and dispatches `ProcessDocumentJob` to Memurai Redis. Worker sends file path + metadata to FastAPI `POST http://127.0.0.1:8001/ingest`.
   >    - `POST /api/chat`: Authenticates user, resolves `organization_id`, `department_id`, and max `clearance_level`, applies Redis rate limiting, writes immutable record to `audit_logs`, and proxies authorized scope + prompt to FastAPI `POST http://127.0.0.1:8001/query`.
   > 2. **Python FastAPI (`ai-service/`, Port 8001):**
   >    - `POST /ingest`: Extracts text + page numbers (`pypdf` / `python-docx`), splits into chunks (`800` chars / `150` overlap), generates 768-dim embeddings via Ollama `nomic-embed-text`, inserts into `document_chunks` (`id`, `document_id`, `organization_id`, `department_id`, `clearance_level`, `page_number`, `content`, `embedding vector(768)`), and marks document `indexed`.
   >    - `POST /query`: Embeds prompt, runs parameterized cosine similarity (`<=>`) filtered strictly by `WHERE organization_id = %s AND department_id = %s AND clearance_level <= %s`, streams grounded response from `llama3.2` via SSE with source citations (`document_title`, `page_number`), and refuses to answer if context is insufficient.
   > 3. **Next.js (`frontend/`, Port 3000):**
   >    - Login page, Document Upload & Status Dashboard (`pending`/`processing`/`indexed`), Admin Audit Log Viewer, and Streaming AI Chat UI (`@ai-sdk/react`) with clickable document/page citations.
   > 4. **Testing & CI/CD (`.github/workflows/ci.yml`):**
   >    - Pest feature tests proving zero-trust RBAC isolation across clearance levels and organizations.
   >    - Playwright E2E test covering login, upload, and chat query.
   >
   > **Build Execution Phases:**
   > 1. **Phase 1:** Laravel `.env` setup, PostgreSQL migrations (`vector` extension, `document_chunks`, RBAC tables, `audit_logs`), Eloquent models, Sanctum auth, and seeders (`admin`, `manager`, `staff`).
   > 2. **Phase 2:** Private file upload controller, `ProcessDocumentJob` Redis queue worker, rate limiting, and chat proxy controller.
   > 3. **Phase 3:** Complete Python FastAPI microservice (`main.py`, `database.py`, `rag.py`) with chunking, Ollama embeddings, RBAC-filtered `pgvector` search, and SSE streaming.
   > 4. **Phase 4:** Next.js frontend pages, auth state, upload modal, streaming chat UI, and audit log viewer.
   > 5. **Phase 5:** Pest RBAC isolation tests, Playwright E2E tests, and GitHub Actions workflow.
   >
   > **Immediate Action:** Begin with **Phase 1** only, provide exact Windows PowerShell commands and complete Laravel migration/model/seeder code, and wait for my confirmation before starting Phase 2.

---

10. **Daily Windows Runbook (4 VS Code Terminals)**
    10.1. **Terminal 1 (`backend/`):** `php artisan serve --port=8000`
    10.2. **Terminal 2 (`backend/`):** `php artisan queue:work redis`
    10.3. **Terminal 3 (`ai-service/`):** `.\venv\Scripts\activate` then `uvicorn main:app --reload --port 8001`
    10.4. **Terminal 4 (`frontend/`):** `npm run dev`