<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('documents', function (Blueprint $table) {
            // Versioning: same title + department in one organization.
            $table->unsignedInteger('version')->default(1);
            $table->timestamp('superseded_at')->nullable();
            $table->foreignId('superseded_by')->nullable()->constrained('documents')->nullOnDelete();

            // Document-trust defenses.
            $table->unsignedInteger('pii_redactions')->default(0);
            $table->timestamp('approved_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();

            $table->index(['organization_id', 'department_id', 'title']);
        });

        // Hybrid search: a generated full-text column next to the embedding.
        // The AI service is the only reader; SQLite (tests) has no such search.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE document_chunks ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(document_title, '') || ' ' || content)) STORED");
            DB::statement('CREATE INDEX document_chunks_tsv_index ON document_chunks USING GIN (tsv)');
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS document_chunks_tsv_index');
            DB::statement('ALTER TABLE document_chunks DROP COLUMN IF EXISTS tsv');
        }

        Schema::table('documents', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'department_id', 'title']);
            $table->dropConstrainedForeignId('approved_by');
            $table->dropConstrainedForeignId('superseded_by');
            $table->dropColumn(['version', 'superseded_at', 'pii_redactions', 'approved_at']);
        });
    }
};
