<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Event calendar (module 29). Events are extracted from documents by the
     * AI service, carry the document's RBAC columns like document_chunks, and
     * wait for a reviewer before anyone sees them.
     */
    public function up(): void
    {
        Schema::create('document_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('document_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('department_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('clearance_level');
            $table->string('title', 200);
            $table->text('snippet');
            $table->unsignedInteger('page_number')->default(1);
            // Shown on the calendar; a reviewer may correct them.
            $table->date('starts_at');
            $table->date('ends_at')->nullable();
            // As extracted, so a re-index can match an earlier review decision.
            $table->date('extracted_starts_at');
            $table->date('extracted_ends_at')->nullable();
            $table->string('status', 20)->default('pending');
            $table->foreignId('confirmed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('confirmed_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status', 'starts_at']);
            $table->index('document_id');
        });

        Schema::create('event_dismissals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('event_id')->constrained('document_events')->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['user_id', 'event_id']);
        });

        Schema::table('organizations', function (Blueprint $table) {
            $table->unsignedSmallInteger('event_reminder_days')->default(7);
        });
    }

    public function down(): void
    {
        Schema::table('organizations', fn (Blueprint $table) => $table->dropColumn('event_reminder_days'));
        Schema::dropIfExists('event_dismissals');
        Schema::dropIfExists('document_events');
    }
};
