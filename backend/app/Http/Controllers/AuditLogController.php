<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Document;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Symfony\Component\HttpFoundation\StreamedResponse;

class AuditLogController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $logs = $this->filtered($request)
            ->with('user:id,name,email')
            ->latest('id')
            ->paginate(20);

        $titles = $this->titles($request, $logs->getCollection()->pluck('retrieved_document_ids')->flatten()->unique()->all());

        return response()->json([
            'data' => $logs->getCollection()->map(fn (AuditLog $log) => [
                'id' => $log->id,
                'action' => $log->action,
                'prompt' => $log->prompt,
                'ip_address' => $log->ip_address,
                'created_at' => $log->created_at?->toIso8601String(),
                'user' => $log->user?->only(['id', 'name', 'email']),
                'documents' => collect($log->retrieved_document_ids)
                    ->map(fn ($id) => ['id' => $id, 'title' => $titles[$id] ?? 'Deleted document'])
                    ->values(),
            ]),
            'meta' => [
                'current_page' => $logs->currentPage(),
                'last_page' => $logs->lastPage(),
                'per_page' => $logs->perPage(),
                'total' => $logs->total(),
            ],
        ]);
    }

    /**
     * The same filtered log as a CSV file, every page, streamed in chunks so
     * a long history never sits in memory at once.
     */
    public function export(Request $request): StreamedResponse
    {
        $query = $this->filtered($request)->with('user:id,name,email');
        $filename = 'audit-log-'.now()->format('Y-m-d-His').'.csv';

        return response()->streamDownload(function () use ($query, $request) {
            $out = fopen('php://output', 'w');
            // A byte-order mark so Excel opens UTF-8 correctly.
            fwrite($out, "\xEF\xBB\xBF");
            fputcsv($out, ['id', 'time', 'user', 'email', 'action', 'prompt_or_change', 'cited_documents', 'ip_address'], escape: '');

            $query->orderBy('id')->chunk(500, function ($logs) use ($out, $request) {
                $titles = $this->titles($request, $logs->pluck('retrieved_document_ids')->flatten()->unique()->all());

                foreach ($logs as $log) {
                    fputcsv($out, array_map([$this, 'cell'], [
                        $log->id,
                        $log->created_at?->toIso8601String(),
                        $log->user?->name,
                        $log->user?->email,
                        $log->action,
                        $log->prompt,
                        collect($log->retrieved_document_ids)->map(fn ($id) => $titles[$id] ?? "Deleted document #{$id}")->implode('; '),
                        $log->ip_address,
                    ]), escape: '');
                }
            });

            fclose($out);
        }, $filename, ['Content-Type' => 'text/csv; charset=UTF-8']);
    }

    /**
     * @return Builder<AuditLog>
     */
    private function filtered(Request $request): Builder
    {
        $user = $request->user();

        abort_unless($user->isAdmin(), 403, 'Only administrators can view audit logs.');

        $search = trim((string) $request->query('q', ''));

        return AuditLog::query()
            ->where('organization_id', $user->organization_id)
            ->when($search !== '', function ($query) use ($search) {
                $term = '%'.mb_strtolower($search).'%';

                $query->where(function ($inner) use ($term) {
                    $inner->whereRaw('LOWER(prompt) LIKE ?', [$term])
                        ->orWhereHas('user', fn ($users) => $users->whereRaw('LOWER(name) LIKE ?', [$term]));
                });
            });
    }

    /**
     * Resolve cited document IDs to titles in one query.
     *
     * @param  list<int>  $ids
     * @return Collection<int, string>
     */
    private function titles(Request $request, array $ids)
    {
        return Document::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereIn('id', $ids)
            ->pluck('title', 'id');
    }

    /**
     * Spreadsheet apps run cells that start with = + - @ as formulas; prefix
     * them so a crafted prompt cannot become a formula in a reviewer's Excel.
     */
    private function cell(mixed $value): string
    {
        $value = (string) $value;

        return $value !== '' && in_array($value[0], ['=', '+', '-', '@', "\t", "\r"], true) ? "'".$value : $value;
    }
}
