<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\DocumentEvent;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Event calendar (module 29). Every lookup goes through
 * DocumentEvent::visibleTo(), so an event outside the user's scope answers
 * 404, exactly like a document.
 */
class EventController extends Controller
{
    /** The longest window one request may ask for, in days. */
    private const MAX_WINDOW_DAYS = 400;

    public function index(Request $request): JsonResponse
    {
        $today = DocumentEvent::today();
        $data = $request->validate([
            'from' => ['nullable', 'date_format:Y-m-d'],
            'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
        ]);

        $from = $data['from'] ?? $today->copy()->startOfMonth()->toDateString();
        $to = $data['to'] ?? $today->copy()->endOfMonth()->toDateString();
        abort_if(now()->parse($from)->diffInDays(now()->parse($to)) > self::MAX_WINDOW_DAYS, 422, 'Ask for at most 400 days at a time.');

        $events = DocumentEvent::query()
            ->visibleTo($request->user())
            ->confirmedBetween($from, $to)
            ->with(['document:id,title', 'department:id,name'])
            ->orderBy('starts_at')
            ->orderBy('id')
            ->get();

        return response()->json([
            'data' => $events->map->toApiArray(),
            'meta' => ['from' => $from, 'to' => $to, 'today' => $today->toDateString()],
        ]);
    }

    /**
     * For the reminder banner and the navigation badges: confirmed events in
     * the organization's reminder window that the user has not dismissed,
     * and (for reviewers) how many events wait for review.
     */
    public function upcoming(Request $request): JsonResponse
    {
        $user = $request->user();
        $today = DocumentEvent::today();
        $days = $user->organization?->reminderDays() ?? 7;

        $events = DocumentEvent::query()
            ->visibleTo($user)
            ->confirmedBetween($today->toDateString(), $today->copy()->addDays($days)->toDateString())
            ->whereNotIn('id', DB::table('event_dismissals')->where('user_id', $user->id)->select('event_id'))
            ->with(['document:id,title', 'department:id,name'])
            ->orderBy('starts_at')
            ->limit(20)
            ->get();

        return response()->json([
            'data' => $events->map->toApiArray(),
            'meta' => [
                'days' => $days,
                'today' => $today->toDateString(),
                'pending_review' => $user->canUploadDocuments()
                    ? DocumentEvent::query()->reviewableBy($user)->where('status', DocumentEvent::STATUS_PENDING)->count()
                    : null,
            ],
        ]);
    }

    /** Silence the reminder for one event; it stays on the calendar. */
    public function dismiss(Request $request, int $event): JsonResponse
    {
        $event = DocumentEvent::query()->visibleTo($request->user())
            ->where('status', DocumentEvent::STATUS_CONFIRMED)
            ->findOrFail($event);

        DB::table('event_dismissals')->insertOrIgnore([
            'user_id' => $request->user()->id,
            'event_id' => $event->id,
            'created_at' => now(),
        ]);

        return response()->json(['message' => 'Reminder dismissed.']);
    }

    public function pending(Request $request): JsonResponse
    {
        $this->reviewer($request);

        $events = DocumentEvent::query()
            ->reviewableBy($request->user())
            ->where('status', DocumentEvent::STATUS_PENDING)
            ->with(['document:id,title', 'department:id,name'])
            ->orderBy('starts_at')
            ->limit(200)
            ->get();

        return response()->json(['data' => $events->map->toApiArray()]);
    }

    /** Confirm, optionally correcting a mis-parsed title or dates. */
    public function confirm(Request $request, int $event): JsonResponse
    {
        $event = $this->reviewable($request, $event);

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'starts_at' => ['sometimes', 'required', 'date_format:Y-m-d'],
            'ends_at' => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:starts_at'],
        ]);

        $event->forceFill([
            ...$data,
            'status' => DocumentEvent::STATUS_CONFIRMED,
            'confirmed_by' => $request->user()->id,
            'confirmed_at' => now(),
        ]);

        // A corrected start after the existing end would be a backwards range.
        if ($event->ends_at && $event->ends_at->lt($event->starts_at)) {
            $event->ends_at = null;
        }
        $event->save();

        AuditLog::recordAdminAction(
            $request->user(),
            AuditLog::ACTION_EVENT_CONFIRMED,
            sprintf('Confirmed event "%s" on %s from "%s"', $event->title, $this->range($event), $event->document?->title),
            $request->ip(),
        );

        return response()->json(['data' => $event->load(['document:id,title', 'department:id,name'])->toApiArray()]);
    }

    public function reject(Request $request, int $event): JsonResponse
    {
        $event = $this->reviewable($request, $event);

        $event->forceFill([
            'status' => DocumentEvent::STATUS_REJECTED,
            'confirmed_by' => $request->user()->id,
            'confirmed_at' => now(),
        ])->save();

        AuditLog::recordAdminAction(
            $request->user(),
            AuditLog::ACTION_EVENT_REJECTED,
            sprintf('Rejected extracted event "%s" on %s from "%s"', $event->title, $this->range($event), $event->document?->title),
            $request->ip(),
        );

        return response()->json(['data' => $event->load(['document:id,title', 'department:id,name'])->toApiArray()]);
    }

    private function reviewer(Request $request): void
    {
        abort_unless($request->user()->canUploadDocuments(), 403, 'Only administrators and managers can review events.');
    }

    private function reviewable(Request $request, int $id): DocumentEvent
    {
        $this->reviewer($request);

        return DocumentEvent::query()->reviewableBy($request->user())->with('document:id,title')->findOrFail($id);
    }

    private function range(DocumentEvent $event): string
    {
        return $event->ends_at
            ? $event->starts_at->toDateString().' to '.$event->ends_at->toDateString()
            : $event->starts_at->toDateString();
    }
}
