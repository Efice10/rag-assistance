<?php

use App\Http\Controllers\ProcessingController;
use App\Jobs\ProcessDocumentJob;
use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\Document;
use App\Models\MessageFeedback;
use App\Models\User;
use App\Services\AiServiceClient;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    config(['services.ai.secret' => 'test-internal-secret']);
    $this->t = tenants();
    $this->admin = User::factory()->in($this->t['hr'])->admin()->create();
    $this->manager = User::factory()->in($this->t['procurement'])->manager(3)->create();
    $this->staff = User::factory()->in($this->t['procurement'])->staff(1)->create();
    $this->hrManager = User::factory()->in($this->t['hr'])->manager(3)->create();
    $this->globexAdmin = User::factory()->in($this->t['operations'])->admin()->create();
});

function failedJobRow(Document $document, string $error = 'Job timed out'): int
{
    return DB::table('failed_jobs')->insertGetId([
        'uuid' => (string) Str::uuid(),
        'connection' => 'redis',
        'queue' => 'default',
        'payload' => json_encode([
            'displayName' => ProcessDocumentJob::class,
            'data' => ['commandName' => ProcessDocumentJob::class, 'command' => serialize(new ProcessDocumentJob($document))],
        ]),
        'exception' => "Illuminate\\Queue\\TimeoutExceededException: {$error}\n#0 stack frame",
        'failed_at' => now(),
    ]);
}

describe('versioning', function () {
    it('numbers re-uploads of the same title and department as new versions', function () {
        Storage::fake();
        Queue::fake();
        Sanctum::actingAs($this->manager);

        $upload = fn (string $title) => $this->postJson('/api/documents', [
            'title' => $title,
            'department_id' => $this->t['procurement']->id,
            'clearance_level' => 2,
            'file' => UploadedFile::fake()->create('sop.pdf', 10, 'application/pdf'),
        ])->assertCreated()->json('data.version');

        expect($upload('Procurement SOP'))->toBe(1)
            ->and($upload('procurement sop'))->toBe(2)
            ->and($upload('Travel Policy'))->toBe(1);
    });

    it('supersedes older versions only once the new one is indexed', function () {
        $v1 = Document::factory()->in($this->t['procurement'])->create(['title' => 'SOP', 'status' => 'indexed', 'version' => 1]);
        $v2 = Document::factory()->in($this->t['procurement'])->create(['title' => 'SOP', 'status' => 'pending', 'version' => 2]);

        Http::fake(['*/ingest' => Http::sequence()
            ->push(['detail' => 'Corrupt file'], 422)
            ->push(['status' => 'indexed', 'chunks' => 4, 'pii_redactions' => 2])]);

        // A failed v2 leaves v1 in place.
        (new ProcessDocumentJob($v2))->handle(app(AiServiceClient::class));
        expect($v1->fresh()->isSuperseded())->toBeFalse()
            ->and($v2->fresh()->status)->toBe('failed');

        // A successful v2 tells the AI service to drop v1's chunks, then v1 is superseded.
        (new ProcessDocumentJob($v2->fresh()))->handle(app(AiServiceClient::class));

        Http::assertSent(fn ($request) => $request['supersedes_document_ids'] === [$v1->id]);
        expect($v1->fresh()->superseded_by)->toBe($v2->id)
            ->and($v2->fresh())->status->toBe('indexed')->pii_redactions->toBe(2);
    });

    it('lists current versions only, unless older ones are asked for', function () {
        Document::factory()->in($this->t['procurement'])->create(['title' => 'SOP', 'version' => 1, 'superseded_at' => now()]);
        Document::factory()->in($this->t['procurement'])->create(['title' => 'SOP', 'version' => 2]);
        Sanctum::actingAs($this->manager);

        expect($this->getJson('/api/documents')->json('data.*.version'))->toBe([2])
            ->and($this->getJson('/api/documents?include_superseded=1')->json('data'))->toHaveCount(2);
    });
});

describe('reindex', function () {
    it('lets managers and admins who can see the document queue it again', function (string $who) {
        Queue::fake();
        $document = Document::factory()->in($this->t['procurement'])->create(['status' => 'failed', 'clearance_level' => 2]);
        Sanctum::actingAs($who === 'admin' ? $this->admin : $this->manager);

        $this->postJson("/api/documents/{$document->id}/reindex")->assertOk()->assertJsonPath('data.status', 'pending');

        Queue::assertPushed(ProcessDocumentJob::class, fn ($job) => $job->document->is($document));
    })->with(['admin', 'manager']);

    it('refuses staff, other departments and other organizations', function () {
        Queue::fake();
        $document = Document::factory()->in($this->t['procurement'])->create(['status' => 'failed']);

        Sanctum::actingAs($this->staff);
        $this->postJson("/api/documents/{$document->id}/reindex")->assertForbidden();

        Sanctum::actingAs($this->hrManager);
        $this->postJson("/api/documents/{$document->id}/reindex")->assertNotFound();

        Sanctum::actingAs($this->globexAdmin);
        $this->postJson("/api/documents/{$document->id}/reindex")->assertNotFound();

        Queue::assertNothingPushed();
    });

    it('will not reindex a superseded version, a held document, or one already in progress', function () {
        Queue::fake();
        Sanctum::actingAs($this->manager);
        $old = Document::factory()->in($this->t['procurement'])->create(['superseded_at' => now()]);
        $held = Document::factory()->in($this->t['procurement'])->create(['status' => 'flagged']);
        $busy = Document::factory()->in($this->t['procurement'])->create(['status' => 'processing']);

        $this->postJson("/api/documents/{$old->id}/reindex")->assertUnprocessable();
        $this->postJson("/api/documents/{$held->id}/reindex")->assertUnprocessable();
        $this->postJson("/api/documents/{$busy->id}/reindex")->assertConflict();

        Queue::assertNothingPushed();
    });
});

describe('documents held for review', function () {
    it('stores the flagged outcome reported by the AI service', function () {
        $document = Document::factory()->in($this->t['procurement'])->create(['status' => 'pending']);
        Http::fake(['*/ingest' => Http::response(['status' => 'flagged', 'flag_reasons' => ['asks the model to ignore its instructions']])]);

        (new ProcessDocumentJob($document))->handle(app(AiServiceClient::class));

        expect($document->fresh())
            ->status->toBe('flagged')
            ->error_message->toContain('ignore its instructions');
        Http::assertSent(fn ($request) => $request['allow_flagged'] === false);
    });

    it('lets an admin of the same organization approve it, audited, and reindexes with permission', function () {
        Queue::fake();
        $document = Document::factory()->in($this->t['procurement'])->create(['status' => 'flagged', 'error_message' => 'Held for review: mentions jailbreaking']);
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/documents/{$document->id}/approve")->assertOk()->assertJsonPath('data.approved', true);

        expect($document->fresh())->approved_by->toBe($this->admin->id)->status->toBe('pending');
        expect(AuditLog::sole())
            ->action->toBe(AuditLog::ACTION_DOCUMENT_APPROVED)
            ->prompt->toContain('mentions jailbreaking');
        Queue::assertPushed(ProcessDocumentJob::class);

        Http::fake(['*/ingest' => Http::response(['status' => 'indexed', 'chunks' => 1])]);
        (new ProcessDocumentJob($document->fresh()))->handle(app(AiServiceClient::class));
        Http::assertSent(fn ($request) => $request['allow_flagged'] === true);
    });

    it('refuses approval by managers, by other organizations, and of clean documents', function () {
        $held = Document::factory()->in($this->t['procurement'])->create(['status' => 'flagged']);
        $clean = Document::factory()->in($this->t['procurement'])->create(['status' => 'indexed']);

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/documents/{$held->id}/approve")->assertForbidden();

        Sanctum::actingAs($this->globexAdmin);
        $this->postJson("/api/documents/{$held->id}/approve")->assertNotFound();

        Sanctum::actingAs($this->admin);
        $this->postJson("/api/documents/{$clean->id}/approve")->assertUnprocessable();

        expect($held->fresh()->approved_at)->toBeNull();
    });
});

describe('processing screen', function () {
    it('shows failed and stuck documents and failed jobs of the admin organization only', function () {
        $failed = Document::factory()->in($this->t['procurement'])->create(['status' => 'failed', 'error_message' => 'No text']);
        $stuck = Document::factory()->in($this->t['hr'])->create(['status' => 'pending']);
        $stuck->forceFill(['updated_at' => now()->subHour()])->saveQuietly();
        Document::factory()->in($this->t['hr'])->create(['status' => 'pending']); // recent: not stuck
        $foreign = Document::factory()->in($this->t['operations'])->create(['status' => 'failed']);
        failedJobRow($failed);
        failedJobRow($foreign, 'globex secret failure');
        Sanctum::actingAs($this->admin);

        $data = $this->getJson('/api/admin/processing')->assertOk()->json('data');

        expect(collect($data['failed_documents'])->pluck('id')->all())->toBe([$failed->id])
            ->and(collect($data['stuck_documents'])->pluck('id')->all())->toBe([$stuck->id])
            ->and($data['failed_jobs'])->toHaveCount(1)
            ->and($data['failed_jobs'][0]['document']['id'])->toBe($failed->id)
            ->and($data['failed_jobs'][0]['error'])->toContain('Job timed out')
            ->and(json_encode($data))->not->toContain('globex secret failure');
    });

    it('retries and forgets only failed jobs of the admin organization', function () {
        Queue::fake();
        $own = failedJobRow(Document::factory()->in($this->t['procurement'])->create(['status' => 'failed']));
        $foreign = failedJobRow(Document::factory()->in($this->t['operations'])->create(['status' => 'failed']));
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/admin/failed-jobs/{$foreign}/retry")->assertNotFound();
        $this->deleteJson("/api/admin/failed-jobs/{$foreign}")->assertNotFound();

        $this->postJson("/api/admin/failed-jobs/{$own}/retry")->assertOk();
        Queue::assertPushed(ProcessDocumentJob::class, 1);
        expect(DB::table('failed_jobs')->pluck('id')->all())->toBe([$foreign]);

        $other = failedJobRow(Document::factory()->in($this->t['hr'])->create());
        $this->deleteJson("/api/admin/failed-jobs/{$other}")->assertOk();
        expect(DB::table('failed_jobs')->where('id', $other)->exists())->toBeFalse();
    });

    it('is admin-only', function () {
        Sanctum::actingAs($this->manager);

        $this->getJson('/api/admin/processing')->assertForbidden();
        $this->getJson('/api/admin/metrics')->assertForbidden();
        $this->get('/api/audit-logs/export')->assertForbidden();
    });

    it('reads the document id from a job payload without unserializing it', function () {
        $document = Document::factory()->in($this->t['procurement'])->create();
        $payload = json_encode(['data' => ['commandName' => ProcessDocumentJob::class, 'command' => serialize(new ProcessDocumentJob($document))]]);

        expect(ProcessingController::documentIdFromPayload($payload))->toBe($document->id)
            ->and(ProcessingController::documentIdFromPayload(json_encode(['data' => ['commandName' => 'Other\\Job', 'command' => 'x']])))->toBeNull()
            ->and(ProcessingController::documentIdFromPayload('not json'))->toBeNull();
    });
});

describe('analytics', function () {
    it('counts queries, no-answer rate, top documents and ratings for the admin organization', function () {
        $doc = Document::factory()->in($this->t['procurement'])->create(['title' => 'Procurement SOP', 'clearance_level' => 3]);
        $log = fn (User $user, string $action, array $ids) => AuditLog::create([
            'organization_id' => $user->organization_id, 'user_id' => $user->id,
            'action' => $action, 'prompt' => 'q', 'retrieved_document_ids' => $ids,
        ]);
        $log($this->manager, AuditLog::ACTION_CHAT_QUERY, [$doc->id]);
        $log($this->manager, AuditLog::ACTION_CHAT_QUERY, [$doc->id]);
        $log($this->staff, AuditLog::ACTION_CHAT_QUERY, []);
        $log($this->staff, AuditLog::ACTION_CHAT_QUERY_FAILED, []);
        $log($this->admin, AuditLog::ACTION_USER_CREATED, []); // not a query
        $log($this->globexAdmin, AuditLog::ACTION_CHAT_QUERY, []); // other organization

        $conversation = Conversation::create(['organization_id' => $this->t['acme']->id, 'user_id' => $this->manager->id, 'title' => 'x']);
        $conversation->messages()->create(['role' => 'user', 'content' => 'Is the limit RM 5,000?']);
        $answer = $conversation->messages()->create(['role' => 'assistant', 'content' => 'Yes.']);
        MessageFeedback::create(['organization_id' => $this->t['acme']->id, 'message_id' => $answer->id, 'user_id' => $this->manager->id, 'helpful' => false, 'comment' => 'It is RM 10,000']);

        Sanctum::actingAs($this->admin);
        $data = $this->getJson('/api/admin/metrics?days=7')->assertOk()->json('data');

        expect($data['totals'])->toMatchArray([
            'queries' => 4, 'distinct_users' => 2, 'failed_queries' => 1, 'no_answer' => 1, 'ratings' => 1, 'helpful_rate' => 0,
        ])
            ->and($data['queries_per_day'])->toHaveCount(7)
            ->and(collect($data['queries_per_day'])->last()['count'])->toBe(4)
            ->and($data['top_documents'])->toBe([['id' => $doc->id, 'title' => 'Procurement SOP', 'citations' => 2]])
            ->and($data['documents_by_clearance'][2]['count'])->toBe(1)
            ->and($data['recent_negative_feedback'][0])->toMatchArray(['comment' => 'It is RM 10,000', 'question' => 'Is the limit RM 5,000?']);
    });
});

describe('audit export', function () {
    it('streams the filtered organization log as CSV and defuses formulas', function () {
        AuditLog::create(['organization_id' => $this->t['acme']->id, 'user_id' => $this->manager->id, 'action' => 'chat.query', 'prompt' => '=HYPERLINK("http://evil")', 'retrieved_document_ids' => []]);
        AuditLog::create(['organization_id' => $this->t['acme']->id, 'user_id' => $this->manager->id, 'action' => 'chat.query', 'prompt' => 'Travel limits', 'retrieved_document_ids' => []]);
        AuditLog::create(['organization_id' => $this->t['globex']->id, 'user_id' => $this->globexAdmin->id, 'action' => 'chat.query', 'prompt' => 'Globex HYPERLINK secret', 'retrieved_document_ids' => []]);
        Sanctum::actingAs($this->admin);

        $response = $this->get('/api/audit-logs/export?q=hyperlink')->assertOk();
        $csv = $response->streamedContent();

        expect($response->headers->get('content-type'))->toContain('text/csv')
            ->and($response->headers->get('content-disposition'))->toContain('audit-log-')
            ->and($csv)->toContain("'=HYPERLINK")
            ->not->toContain('Travel limits')
            ->not->toContain('Globex');
    });
});
