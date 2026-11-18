<?php

use App\Models\Document;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    config(['services.ai.secret' => 'test-internal-secret']);
    Storage::fake();
    $this->t = tenants();
    $this->staff = User::factory()->in($this->t['procurement'])->staff(1)->create();
    $this->manager = User::factory()->in($this->t['procurement'])->manager(3)->create();

    $this->docx = Document::factory()->in($this->t['procurement'])->create([
        'title' => 'Leave Policy',
        'file_path' => 'documents/1/leave.docx',
        'mime_type' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'clearance_level' => 1,
    ]);
    Storage::put($this->docx->file_path, 'docx bytes');
});

it('returns the text of a document the user can see, through the AI service', function () {
    Http::fake(['*/preview' => Http::response(['pages' => [['page' => 1, 'text' => 'Staff get 14 days of leave.']], 'truncated' => false])]);
    Sanctum::actingAs($this->staff);

    $this->getJson("/api/documents/{$this->docx->id}/preview")
        ->assertOk()
        ->assertJsonPath('data.format', 'docx')
        ->assertJsonPath('data.pages.0.text', 'Staff get 14 days of leave.');

    Http::assertSent(fn ($request) => str_ends_with($request->url(), '/preview')
        && $request->hasHeader('X-Internal-Secret', 'test-internal-secret')
        && str_ends_with(str_replace('\\', '/', $request['file_path']), 'documents/1/leave.docx'));
});

it('answers 404 for documents outside the user scope, without calling the AI service', function () {
    $confidential = Document::factory()->in($this->t['procurement'])->create(['clearance_level' => 3, 'file_path' => 'documents/1/c.docx']);
    $otherDept = Document::factory()->in($this->t['hr'])->create(['clearance_level' => 1, 'file_path' => 'documents/1/h.docx']);
    $otherOrg = Document::factory()->in($this->t['operations'])->create(['clearance_level' => 1, 'file_path' => 'documents/2/o.docx']);
    Http::fake();
    Sanctum::actingAs($this->staff);

    foreach ([$confidential, $otherDept, $otherOrg] as $document) {
        $this->getJson("/api/documents/{$document->id}/preview")->assertNotFound();
    }

    Http::assertNothingSent();
});

it('lets the browser show PDFs itself', function () {
    $pdf = Document::factory()->in($this->t['procurement'])->create(['file_path' => 'documents/1/sop.pdf']);
    Storage::put($pdf->file_path, '%PDF-1.4');
    Http::fake();
    Sanctum::actingAs($this->manager);

    $this->getJson("/api/documents/{$pdf->id}/preview")->assertOk()->assertJsonPath('data.format', 'pdf');

    Http::assertNothingSent();
});

it('explains when the preview cannot be prepared', function () {
    Http::fake(['*/preview' => Http::response(['detail' => 'boom'], 500)]);
    Sanctum::actingAs($this->staff);

    $this->getJson("/api/documents/{$this->docx->id}/preview")
        ->assertStatus(502)
        ->assertJsonPath('message', 'The preview could not be prepared. Download the document instead.');
});

it('reports a missing stored file', function () {
    // Never written, rather than deleted: this machine's antivirus blocks a
    // PHP process after it deletes files (see CLAUDE.md).
    $missing = Document::factory()->in($this->t['procurement'])->create(['file_path' => 'documents/1/never-stored.docx']);
    Sanctum::actingAs($this->staff);

    $this->getJson("/api/documents/{$missing->id}/preview")->assertNotFound();
});
