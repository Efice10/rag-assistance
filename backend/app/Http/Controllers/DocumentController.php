<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreDocumentRequest;
use App\Jobs\ProcessDocumentJob;
use App\Models\AuditLog;
use App\Models\Document;
use App\Services\AiServiceClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class DocumentController extends Controller
{
    /**
     * Current versions within the user's scope. `?include_superseded=1` adds
     * the older versions too.
     */
    public function index(Request $request): JsonResponse
    {
        $documents = Document::query()
            ->visibleTo($request->user())
            ->unless($request->boolean('include_superseded'), fn ($query) => $query->whereNull('superseded_at'))
            ->with(['department:id,name', 'uploader:id,name'])
            ->latest('id')
            ->get();

        return response()->json(['data' => $documents->map->toApiArray()]);
    }

    /**
     * Uploading a document with the same title into the same department
     * creates the next version. The older one keeps answering until the new
     * one is indexed.
     */
    public function store(StoreDocumentRequest $request): JsonResponse
    {
        $user = $request->user();
        $file = $request->file('file');
        $extension = strtolower($file->getClientOriginalExtension());
        $departmentId = $request->integer('department_id');
        $title = trim($request->validated('title'));

        $path = $file->storeAs(
            "documents/{$user->organization_id}",
            Str::uuid().'.'.$extension,
        );

        $document = Document::create([
            'organization_id' => $user->organization_id,
            'department_id' => $departmentId,
            'uploaded_by' => $user->id,
            'title' => $title,
            'file_path' => $path,
            'mime_type' => StoreDocumentRequest::MIME_TYPES[$extension],
            'clearance_level' => $request->integer('clearance_level'),
            'status' => Document::STATUS_PENDING,
            'version' => Document::nextVersionFor($user->organization_id, $departmentId, $title),
        ]);

        ProcessDocumentJob::dispatch($document);

        return response()->json(
            ['data' => $document->load(['department:id,name', 'uploader:id,name'])->toApiArray()],
            201,
        );
    }

    /**
     * A document outside the user's scope returns 404, not 403, so its
     * existence cannot be inferred by probing IDs.
     */
    public function download(Request $request, int $document): StreamedResponse
    {
        $document = Document::query()->visibleTo($request->user())->findOrFail($document);

        abort_unless(Storage::disk()->exists($document->file_path), 404, 'The stored file is missing.');

        $extension = pathinfo($document->file_path, PATHINFO_EXTENSION);

        return Storage::disk()->download(
            $document->file_path,
            Str::slug($document->title).'.'.$extension,
            ['Content-Type' => $document->mime_type],
        );
    }

    /**
     * Readable text of a document, for viewing it in the app without
     * downloading it. The same access rule as download (404 outside the
     * user's scope). PDFs are shown by the browser from the download route,
     * so they only report their format here.
     */
    public function preview(Request $request, AiServiceClient $ai, int $document): JsonResponse
    {
        $document = Document::query()->visibleTo($request->user())->findOrFail($document);

        abort_unless(Storage::disk()->exists($document->file_path), 404, 'The stored file is missing.');

        $extension = strtolower(pathinfo($document->file_path, PATHINFO_EXTENSION));

        if ($extension === 'pdf') {
            return response()->json(['data' => ['format' => 'pdf', 'pages' => [], 'truncated' => false]]);
        }

        try {
            $preview = $ai->preview(Storage::disk()->path($document->file_path));
        } catch (Throwable $e) {
            report($e);
            abort(502, 'The preview could not be prepared. Download the document instead.');
        }

        return response()->json(['data' => [
            'format' => $extension,
            'pages' => $preview['pages'] ?? [],
            'truncated' => (bool) ($preview['truncated'] ?? false),
        ]]);
    }

    /**
     * Index the document again, for example after a failure or after OCR
     * support was installed. Admins and managers who can see it.
     */
    public function reindex(Request $request, int $document): JsonResponse
    {
        $document = $this->manageable($request, $document);

        abort_if($document->isSuperseded(), 422, 'This is an older version. Reindex the current version instead.');
        abort_if($document->status === Document::STATUS_FLAGGED && ! $document->approved_at, 422, 'This document is held for review. An administrator must approve it first.');
        abort_if(in_array($document->status, [Document::STATUS_PENDING, Document::STATUS_PROCESSING], true)
            && $document->updated_at?->gt(now()->subMinutes(ProcessingController::STUCK_AFTER_MINUTES)), 409, 'This document is already being processed.');

        $document->update(['status' => Document::STATUS_PENDING, 'error_message' => null]);
        ProcessDocumentJob::dispatch($document);

        return response()->json(['data' => $document->load(['department:id,name', 'uploader:id,name'])->toApiArray()]);
    }

    /**
     * Release a document held for review: an administrator has read it and
     * decided the flagged text is harmless. The decision is audited.
     */
    public function approve(Request $request, int $document): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->isAdmin(), 403, 'Only administrators can approve held documents.');

        $document = Document::query()->visibleTo($user)->findOrFail($document);
        abort_unless($document->status === Document::STATUS_FLAGGED, 422, 'Only documents held for review can be approved.');

        $document->forceFill([
            'approved_at' => now(),
            'approved_by' => $user->id,
            'status' => Document::STATUS_PENDING,
        ])->save();

        AuditLog::recordAdminAction(
            $user,
            AuditLog::ACTION_DOCUMENT_APPROVED,
            "Approved held document \"{$document->title}\" (v{$document->version}): {$document->error_message}",
            $request->ip(),
        );

        $document->update(['error_message' => null]);
        ProcessDocumentJob::dispatch($document);

        return response()->json(['data' => $document->load(['department:id,name', 'uploader:id,name'])->toApiArray()]);
    }

    private function manageable(Request $request, int $id): Document
    {
        $document = Document::query()->visibleTo($request->user())->findOrFail($id);

        abort_unless($document->manageableBy($request->user()), 403, 'You cannot manage this document.');

        return $document;
    }
}
