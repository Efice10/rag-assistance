<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\Document;
use App\Models\MessageFeedback;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;

/**
 * Compliance metrics for one organization, computed from data that is
 * already recorded: the audit log, documents and answer ratings. Aggregation
 * happens in PHP so the same code runs on PostgreSQL and SQLite.
 */
class MetricsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        $user = $request->user();
        abort_unless($user->isAdmin(), 403, 'Only administrators can view analytics.');

        $days = min(max($request->integer('days', 30), 1), 365);
        $since = now()->startOfDay()->subDays($days - 1);
        $organizationId = $user->organization_id;

        $chats = AuditLog::query()
            ->where('organization_id', $organizationId)
            ->whereIn('action', [AuditLog::ACTION_CHAT_QUERY, AuditLog::ACTION_CHAT_QUERY_FAILED])
            ->where('created_at', '>=', $since)
            ->get(['user_id', 'action', 'retrieved_document_ids', 'created_at']);

        $answered = $chats->where('action', AuditLog::ACTION_CHAT_QUERY);
        $noAnswer = $answered->filter(fn (AuditLog $log) => empty($log->retrieved_document_ids))->count();

        $perDay = collect(range(0, $days - 1))
            ->mapWithKeys(fn (int $offset) => [$since->copy()->addDays($offset)->toDateString() => 0])
            ->merge($chats->countBy(fn (AuditLog $log) => Carbon::parse($log->created_at)->toDateString()))
            ->map(fn (int $count, string $date) => ['date' => $date, 'count' => $count])
            ->values();

        $citations = $answered->pluck('retrieved_document_ids')->flatten()->countBy()->sortDesc()->take(10);
        $titles = Document::query()->where('organization_id', $organizationId)
            ->whereIn('id', $citations->keys())->pluck('title', 'id');

        $documents = Document::query()->where('organization_id', $organizationId)->whereNull('superseded_at')
            ->get(['status', 'clearance_level']);

        $feedback = MessageFeedback::query()->where('organization_id', $organizationId)
            ->where('created_at', '>=', $since)->get(['helpful']);

        $negative = MessageFeedback::query()
            ->where('organization_id', $organizationId)
            ->where('helpful', false)
            ->with(['message:id,conversation_id,content', 'message.conversation:id,user_id', 'user:id,name'])
            ->latest('updated_at')
            ->limit(10)
            ->get();

        return response()->json(['data' => [
            'days' => $days,
            'totals' => [
                'queries' => $chats->count(),
                'distinct_users' => $chats->pluck('user_id')->unique()->count(),
                'failed_queries' => $chats->where('action', AuditLog::ACTION_CHAT_QUERY_FAILED)->count(),
                'no_answer' => $noAnswer,
                'no_answer_rate' => $answered->count() ? round($noAnswer / $answered->count(), 3) : null,
                'ratings' => $feedback->count(),
                'helpful_rate' => $feedback->count() ? round($feedback->where('helpful', true)->count() / $feedback->count(), 3) : null,
            ],
            'queries_per_day' => $perDay,
            'top_documents' => $citations->map(fn (int $count, $id) => [
                'id' => (int) $id,
                'title' => $titles[$id] ?? 'Deleted document',
                'citations' => $count,
            ])->values(),
            'documents_by_status' => $documents->countBy('status'),
            'documents_by_clearance' => collect(Document::CLEARANCE_LABELS)
                ->map(fn (string $label, int $level) => [
                    'level' => $level,
                    'label' => $label,
                    'count' => $documents->where('clearance_level', $level)->count(),
                ])->values(),
            'recent_negative_feedback' => $negative->map(fn (MessageFeedback $item) => [
                'id' => $item->id,
                'user' => $item->user?->name,
                'comment' => $item->comment,
                'answer' => Str::limit((string) $item->message?->content, 200),
                'question' => Str::limit((string) $item->message?->conversation?->messages()->reorder()
                    ->where('id', '<', $item->message_id)->where('role', 'user')->latest('id')->value('content'), 200),
                'rated_at' => $item->updated_at?->toIso8601String(),
            ]),
        ]]);
    }
}
