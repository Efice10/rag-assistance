<?php

use App\Jobs\ProcessDocumentJob;
use App\Models\AuditLog;
use App\Models\Document;
use App\Models\DocumentEvent;
use App\Models\User;
use App\Services\AiServiceClient;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    config(['services.ai.secret' => 'test-internal-secret', 'services.calendar.timezone' => 'Asia/Kuala_Lumpur']);
    Carbon::setTestNow(Carbon::parse('2026-11-18 10:00', 'Asia/Kuala_Lumpur'));

    $this->t = tenants();
    $this->admin = User::factory()->in($this->t['hr'])->admin()->create();
    $this->manager = User::factory()->in($this->t['procurement'])->manager(3)->create();
    $this->staff = User::factory()->in($this->t['procurement'])->staff(1)->create();
    $this->hrManager = User::factory()->in($this->t['hr'])->manager(3)->create();
    $this->globexAdmin = User::factory()->in($this->t['operations'])->admin()->create();

    $this->publicDoc = Document::factory()->in($this->t['procurement'])->create(['title' => 'Public Memo', 'clearance_level' => 1]);
    $this->confidentialDoc = Document::factory()->in($this->t['procurement'])->create(['title' => 'Board Memo', 'clearance_level' => 3]);
    $this->restrictedDoc = Document::factory()->in($this->t['procurement'])->create(['title' => 'Restricted Memo', 'clearance_level' => 4]);
    $this->globexDoc = Document::factory()->in($this->t['operations'])->create(['title' => 'Globex Memo', 'clearance_level' => 1]);
});

afterEach(fn () => Carbon::setTestNow());

/** An event as the AI service would store it, copying the document's RBAC columns. */
function eventFor(Document $document, array $overrides = []): DocumentEvent
{
    $event = new DocumentEvent;
    $event->forceFill(array_merge([
        'document_id' => $document->id,
        'organization_id' => $document->organization_id,
        'department_id' => $document->department_id,
        'clearance_level' => $document->clearance_level,
        'title' => "Meeting from {$document->title}",
        'snippet' => 'The meeting is on 1-2 December 2026.',
        'page_number' => 2,
        'starts_at' => '2026-12-01',
        'ends_at' => '2026-12-02',
        'extracted_starts_at' => '2026-12-01',
        'extracted_ends_at' => '2026-12-02',
        'status' => DocumentEvent::STATUS_CONFIRMED,
    ], $overrides))->save();

    return $event;
}

function titlesFrom($response): array
{
    return collect($response->assertOk()->json('data'))->pluck('title')->sort()->values()->all();
}

describe('visibility', function () {
    beforeEach(function () {
        eventFor($this->publicDoc);
        eventFor($this->confidentialDoc);
        eventFor($this->restrictedDoc);
        eventFor($this->globexDoc);
        eventFor($this->publicDoc, ['title' => 'Still pending', 'status' => DocumentEvent::STATUS_PENDING]);
        eventFor($this->publicDoc, ['title' => 'Rejected junk', 'status' => DocumentEvent::STATUS_REJECTED]);
    });

    it('shows each person only confirmed events of documents they may see', function (string $who, array $expected) {
        Sanctum::actingAs($this->{$who});

        expect(titlesFrom($this->getJson('/api/events?from=2026-12-01&to=2026-12-31')))->toBe($expected);
    })->with([
        'staff, clearance 1' => ['staff', ['Meeting from Public Memo']],
        'manager, clearance 3' => ['manager', ['Meeting from Board Memo', 'Meeting from Public Memo']],
        'admin, other department, clearance 4' => ['admin', ['Meeting from Board Memo', 'Meeting from Public Memo', 'Meeting from Restricted Memo']],
        'manager of another department' => ['hrManager', []],
        'admin of another organization' => ['globexAdmin', ['Meeting from Globex Memo']],
    ]);

    it('returns events overlapping the window, defaulting to the current month', function () {
        eventFor($this->publicDoc, ['title' => 'November training', 'starts_at' => '2026-11-20', 'ends_at' => null]);
        Sanctum::actingAs($this->staff);

        expect(titlesFrom($this->getJson('/api/events')))->toBe(['November training'])
            ->and(titlesFrom($this->getJson('/api/events?from=2026-12-02&to=2026-12-05')))->toBe(['Meeting from Public Memo']);
    });

    it('shows past events added automatically, marked as such, and never as reminders', function () {
        eventFor($this->publicDoc, ['title' => 'Safety audit', 'starts_at' => '2026-11-03', 'ends_at' => null, 'confirmed_by' => null]);
        $reviewed = eventFor($this->publicDoc, ['title' => 'Reviewed one', 'starts_at' => '2026-11-05', 'ends_at' => null]);
        $reviewed->forceFill(['confirmed_by' => $this->manager->id])->save();
        Sanctum::actingAs($this->staff);

        $events = collect($this->getJson('/api/events?from=2026-11-01&to=2026-11-30')->assertOk()->json('data'))->keyBy('title');

        expect($events['Safety audit']['auto_confirmed'])->toBeTrue()
            ->and($events['Reviewed one']['auto_confirmed'])->toBeFalse()
            ->and(titlesFrom($this->getJson('/api/events/upcoming')))->not->toContain('Safety audit');
    });

    it('answers 404 for dismissing an event the user cannot see', function () {
        $restricted = DocumentEvent::where('clearance_level', 4)->sole();
        Sanctum::actingAs($this->staff);

        $this->postJson("/api/events/{$restricted->id}/dismiss")->assertNotFound();
    });
});

describe('upcoming reminders', function () {
    it('lists confirmed events within the organization window, minus dismissed ones', function () {
        $soon = eventFor($this->publicDoc, ['title' => 'Soon', 'starts_at' => '2026-11-20', 'ends_at' => null]);
        eventFor($this->publicDoc, ['title' => 'Ongoing', 'starts_at' => '2026-11-16', 'ends_at' => '2026-11-19']);
        eventFor($this->publicDoc, ['title' => 'Too far', 'starts_at' => '2026-12-20', 'ends_at' => null]);
        eventFor($this->publicDoc, ['title' => 'Over', 'starts_at' => '2026-11-10', 'ends_at' => '2026-11-17']);
        Sanctum::actingAs($this->staff);

        expect(titlesFrom($this->getJson('/api/events/upcoming')))->toBe(['Ongoing', 'Soon']);

        $this->postJson("/api/events/{$soon->id}/dismiss")->assertOk();
        $this->postJson("/api/events/{$soon->id}/dismiss")->assertOk(); // idempotent

        expect(titlesFrom($this->getJson('/api/events/upcoming')))->toBe(['Ongoing'])
            // Dismissed reminders stay on the calendar.
            ->and(titlesFrom($this->getJson('/api/events?from=2026-11-01&to=2026-11-30')))->toContain('Soon');
    });

    it('uses the reminder window the admin set for the organization', function () {
        eventFor($this->publicDoc, ['title' => 'In 20 days', 'starts_at' => '2026-12-08', 'ends_at' => null]);
        Sanctum::actingAs($this->staff);
        expect(titlesFrom($this->getJson('/api/events/upcoming')))->toBe([]);

        Sanctum::actingAs($this->admin);
        $this->putJson('/api/admin/settings', ['event_reminder_days' => 30])->assertOk()->assertJsonPath('data.event_reminder_days', 30);
        expect(AuditLog::sole()->action)->toBe(AuditLog::ACTION_SETTINGS_UPDATED);

        // A new request loads the organization afresh.
        Sanctum::actingAs($this->staff->fresh());
        $this->getJson('/api/events/upcoming')->assertJsonPath('meta.days', 30);
        expect(titlesFrom($this->getJson('/api/events/upcoming')))->toBe(['In 20 days']);
    });

    it('lets only admins change settings, within bounds', function () {
        Sanctum::actingAs($this->manager);
        $this->putJson('/api/admin/settings', ['event_reminder_days' => 14])->assertForbidden();

        Sanctum::actingAs($this->admin);
        $this->putJson('/api/admin/settings', ['event_reminder_days' => 0])->assertUnprocessable();
        $this->putJson('/api/admin/settings', ['event_reminder_days' => 61])->assertUnprocessable();
    });

    it('counts events waiting for review for reviewers only', function () {
        eventFor($this->publicDoc, ['status' => DocumentEvent::STATUS_PENDING]);
        eventFor($this->confidentialDoc, ['status' => DocumentEvent::STATUS_PENDING]);

        Sanctum::actingAs($this->manager);
        $this->getJson('/api/events/upcoming')->assertJsonPath('meta.pending_review', 2);

        Sanctum::actingAs($this->staff);
        $this->getJson('/api/events/upcoming')->assertJsonPath('meta.pending_review', null);
    });
});

describe('review', function () {
    beforeEach(function () {
        $this->pending = eventFor($this->confidentialDoc, ['status' => DocumentEvent::STATUS_PENDING, 'title' => 'Board meeting']);
        $this->otherDept = eventFor(
            Document::factory()->in($this->t['hr'])->create(['clearance_level' => 1]),
            ['status' => DocumentEvent::STATUS_PENDING, 'title' => 'HR briefing'],
        );
    });

    it('lists pending events per reviewer scope', function () {
        Sanctum::actingAs($this->manager);
        expect(titlesFrom($this->getJson('/api/events/pending')))->toBe(['Board meeting']);

        Sanctum::actingAs($this->admin);
        expect(titlesFrom($this->getJson('/api/events/pending')))->toBe(['Board meeting', 'HR briefing']);

        Sanctum::actingAs($this->staff);
        $this->getJson('/api/events/pending')->assertForbidden();
    });

    it('confirms with corrections, audited, and the event appears on the calendar', function () {
        Sanctum::actingAs($this->manager);

        $this->postJson("/api/events/{$this->pending->id}/confirm", [
            'title' => 'Board meeting (Room 3)',
            'starts_at' => '2026-12-02',
            'ends_at' => '2026-12-03',
        ])->assertOk()->assertJsonPath('data.status', 'confirmed')->assertJsonPath('data.starts_at', '2026-12-02');

        expect($this->pending->fresh())
            ->confirmed_by->toBe($this->manager->id)
            ->extracted_starts_at->toDateString()->toBe('2026-12-01'); // kept for re-index matching
        expect(AuditLog::sole())
            ->action->toBe(AuditLog::ACTION_EVENT_CONFIRMED)
            ->prompt->toContain('Board meeting (Room 3)', '2026-12-02 to 2026-12-03', 'Board Memo');

        expect(titlesFrom($this->getJson('/api/events?from=2026-12-01&to=2026-12-31')))->toContain('Board meeting (Room 3)');
    });

    it('rejects, audited, and the event never shows', function () {
        Sanctum::actingAs($this->admin);

        $this->postJson("/api/events/{$this->pending->id}/reject")->assertOk()->assertJsonPath('data.status', 'rejected');

        expect(AuditLog::sole()->action)->toBe(AuditLog::ACTION_EVENT_REJECTED)
            ->and(titlesFrom($this->getJson('/api/events?from=2026-12-01&to=2026-12-31')))->not->toContain('Board meeting');
    });

    it('refuses staff, other departments, other organizations and bad corrections', function () {
        Sanctum::actingAs($this->staff);
        $this->postJson("/api/events/{$this->pending->id}/confirm")->assertForbidden();
        $this->postJson("/api/events/{$this->pending->id}/reject")->assertForbidden();

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/events/{$this->otherDept->id}/confirm")->assertNotFound();
        $this->postJson("/api/events/{$this->pending->id}/confirm", ['starts_at' => '2026-12-05', 'ends_at' => '2026-12-01'])
            ->assertUnprocessable();

        Sanctum::actingAs($this->globexAdmin);
        $this->postJson("/api/events/{$this->pending->id}/reject")->assertNotFound();

        expect($this->pending->fresh()->status)->toBe(DocumentEvent::STATUS_PENDING)
            ->and(AuditLog::count())->toBe(0);
    });
});

it('tells the AI service which day is today in the calendar time zone', function () {
    // 23:30 UTC on 17 November is already 18 November in Kuala Lumpur.
    Carbon::setTestNow(Carbon::parse('2026-11-17 23:30', 'UTC'));
    Http::fake(['*/ingest' => Http::response(['status' => 'indexed', 'chunks' => 1, 'events' => 2])]);

    (new ProcessDocumentJob($this->publicDoc))->handle(app(AiServiceClient::class));

    Http::assertSent(fn ($request) => $request['today'] === '2026-11-18');
});
