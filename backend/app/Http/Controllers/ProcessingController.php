<?php

namespace App\Http\Controllers;

use App\Jobs\ProcessDocumentJob;
use App\Models\Document;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Admin view of ingestion problems, in place of Horizon (which needs pcntl
 * and does not run on Windows): failed documents, documents stuck waiting
 * for a queue worker, and raw failed queue jobs. Everything is limited to
 * the admin's own organization.
 */
class ProcessingController extends Controller
{
    /** Pending or processing for longer than this means no worker picked it up. */
    public const STUCK_AFTER_MINUTES = 15;

    public function index(Request $request): JsonResponse
    {
        $organizationId = $this->adminOrganization($request);

        $documents = Document::query()
            ->where('organization_id', $organizationId)
            ->where(fn ($query) => $query
                ->where('status', Document::STATUS_FAILED)
                ->orWhere(fn ($stuck) => $stuck
                    ->whereIn('status', [Document::STATUS_PENDING, Document::STATUS_PROCESSING])
                    ->where('updated_at', '<', now()->subMinutes(self::STUCK_AFTER_MINUTES))))
            ->with(['department:id,name', 'uploader:id,name'])
            ->latest('updated_at')
            ->limit(200)
            ->get();

        return response()->json([
            'data' => [
                'failed_documents' => $documents->where('status', Document::STATUS_FAILED)->values()->map->toApiArray(),
                'stuck_documents' => $documents->where('status', '!=', Document::STATUS_FAILED)->values()->map->toApiArray(),
                'failed_jobs' => $this->failedJobs($organizationId)->map(fn (array $job) => [
                    'id' => $job['id'],
                    'queue' => $job['queue'],
                    'job' => $job['job'],
                    'document' => $job['document']?->only(['id', 'title']),
                    'error' => $job['error'],
                    'failed_at' => $job['failed_at'],
                ])->values(),
                'stuck_after_minutes' => self::STUCK_AFTER_MINUTES,
            ],
        ]);
    }

    /**
     * Retry a failed queue job: the document is queued again and the failure
     * record removed.
     */
    public function retry(Request $request, int $failedJob): JsonResponse
    {
        $job = $this->ownFailedJob($request, $failedJob);

        $job['document']->update(['status' => Document::STATUS_PENDING, 'error_message' => null]);
        ProcessDocumentJob::dispatch($job['document']);
        DB::table('failed_jobs')->where('id', $job['id'])->delete();

        return response()->json(['message' => 'The document was queued again.']);
    }

    public function forget(Request $request, int $failedJob): JsonResponse
    {
        $job = $this->ownFailedJob($request, $failedJob);

        DB::table('failed_jobs')->where('id', $job['id'])->delete();

        return response()->json(['message' => 'The failure record was removed.']);
    }

    private function adminOrganization(Request $request): int
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only administrators can view processing problems.');

        return $request->user()->organization_id;
    }

    /**
     * @return array{id: int, queue: string, job: string, document: Document|null, error: string, failed_at: string}
     */
    private function ownFailedJob(Request $request, int $id): array
    {
        $job = $this->failedJobs($this->adminOrganization($request))->firstWhere('id', $id);

        abort_if($job === null || $job['document'] === null, 404, 'Failed job not found.');

        return $job;
    }

    /**
     * failed_jobs is shared by every tenant, so each row is matched to an
     * organization through the document it was processing. Rows that cannot
     * be matched are never shown to anyone.
     *
     * @return Collection<int, array{id: int, queue: string, job: string, document: Document|null, error: string, failed_at: string}>
     */
    private function failedJobs(int $organizationId): Collection
    {
        $rows = DB::table('failed_jobs')->latest('id')->limit(500)->get();

        $rows = $rows->map(fn (object $row) => [
            'row' => $row,
            'document_id' => self::documentIdFromPayload((string) $row->payload),
        ])->filter(fn (array $item) => $item['document_id'] !== null);

        $documents = Document::query()
            ->where('organization_id', $organizationId)
            ->whereIn('id', $rows->pluck('document_id'))
            ->get()
            ->keyBy('id');

        return $rows
            ->filter(fn (array $item) => $documents->has($item['document_id']))
            ->map(function (array $item) use ($documents) {
                $payload = json_decode((string) $item['row']->payload, true) ?: [];

                return [
                    'id' => (int) $item['row']->id,
                    'queue' => (string) $item['row']->queue,
                    'job' => class_basename((string) ($payload['displayName'] ?? 'Job')),
                    'document' => $documents[$item['document_id']],
                    'error' => Str::limit(strtok((string) $item['row']->exception, "\n") ?: 'Unknown error', 300),
                    'failed_at' => (string) $item['row']->failed_at,
                ];
            })
            ->values();
    }

    /**
     * Read the document id out of a queued ProcessDocumentJob without
     * unserializing it (unserializing untrusted payloads is never safe).
     */
    public static function documentIdFromPayload(string $payload): ?int
    {
        $data = json_decode($payload, true);

        if (($data['data']['commandName'] ?? null) !== ProcessDocumentJob::class) {
            return null;
        }

        $pattern = '/s:5:"class";s:\d+:"'.preg_quote(Document::class, '/').'";s:2:"id";i:(\d+);/';

        return preg_match($pattern, (string) ($data['data']['command'] ?? ''), $match) ? (int) $match[1] : null;
    }
}
