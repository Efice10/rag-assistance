<?php

namespace App\Jobs;

use App\Models\Document;
use App\Services\AiServiceClient;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Http\Client\RequestException;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Throwable;

class ProcessDocumentJob implements ShouldQueue
{
    use Queueable;

    public int $tries = 1;

    public int $timeout = 900;

    public function __construct(public Document $document) {}

    public function handle(AiServiceClient $ai): void
    {
        $document = $this->document;

        $document->update(['status' => Document::STATUS_PROCESSING, 'error_message' => null]);

        // Earlier versions lose their chunks only when this one indexes, in
        // the same transaction, so a failed upload never removes an answer.
        $older = $document->olderVersions()->pluck('id')->all();

        try {
            $result = $ai->ingest([
                'document_id' => $document->id,
                'organization_id' => $document->organization_id,
                'department_id' => $document->department_id,
                'clearance_level' => $document->clearance_level,
                'title' => $document->title,
                'mime_type' => $document->mime_type,
                // Absolute path on this machine: the AI service reads the file directly.
                'file_path' => Storage::disk()->path($document->file_path),
                'supersedes_document_ids' => $older,
                'allow_flagged' => $document->approved_at !== null,
            ]);
        } catch (Throwable $e) {
            report($e);
            $this->markFailed($e);

            return;
        }

        // The AI service writes the outcome itself; this covers the case where
        // it answered but could not write the row.
        $document->refresh();

        if (($result['status'] ?? null) === Document::STATUS_FLAGGED) {
            if ($document->status !== Document::STATUS_FLAGGED) {
                $document->update([
                    'status' => Document::STATUS_FLAGGED,
                    'error_message' => Str::limit('Held for review: '.implode('; ', $result['flag_reasons'] ?? []), 500),
                ]);
            }

            return;
        }

        if ($document->status === Document::STATUS_PROCESSING) {
            $document->forceFill([
                'status' => Document::STATUS_INDEXED,
                'pii_redactions' => (int) ($result['pii_redactions'] ?? 0),
            ])->save();
        }

        if ($older !== []) {
            Document::query()->whereKey($older)->whereNull('superseded_at')
                ->update(['superseded_at' => now(), 'superseded_by' => $document->id]);
        }
    }

    public function failed(?Throwable $e): void
    {
        $this->markFailed($e);
    }

    private function markFailed(?Throwable $e): void
    {
        // Prefer the AI service's own explanation ("No extractable text…") over
        // the raw HTTP exception text.
        $message = $e instanceof RequestException
            ? ($e->response->json('detail') ?? 'The AI service returned an error ('.$e->response->status().').')
            : ($e?->getMessage() ?? 'Document processing failed.');

        $this->document->update([
            'status' => Document::STATUS_FAILED,
            'error_message' => Str::limit(is_string($message) ? $message : json_encode($message), 500),
        ]);
    }
}
