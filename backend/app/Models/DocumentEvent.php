<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A dated event found in a document (module 29). Rows are written by the AI
 * service at ingest; Laravel only reads them and records review decisions.
 */
class DocumentEvent extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_CONFIRMED = 'confirmed';

    public const STATUS_REJECTED = 'rejected';

    protected function casts(): array
    {
        return [
            'starts_at' => 'date',
            'ends_at' => 'date',
            'extracted_starts_at' => 'date',
            'extracted_ends_at' => 'date',
            'confirmed_at' => 'datetime',
            'clearance_level' => 'integer',
            'page_number' => 'integer',
        ];
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(Document::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    /**
     * The same rule as Document::scopeVisibleTo(), on the event's own copy of
     * the document's RBAC columns: an event is visible to exactly the people
     * who may see its source document.
     *
     * @param  Builder<DocumentEvent>  $query
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query
            ->where('organization_id', $user->organization_id)
            ->where('clearance_level', '<=', $user->clearance_level)
            ->when(! $user->isAdmin(), fn (Builder $q) => $q->where('department_id', $user->department_id));
    }

    /**
     * Events a person may confirm or reject: those they can see, if they are
     * allowed to manage documents (admins and managers; never staff).
     *
     * @param  Builder<DocumentEvent>  $query
     */
    public function scopeReviewableBy(Builder $query, User $user): void
    {
        $query->visibleTo($user)->when(! $user->canUploadDocuments(), fn (Builder $q) => $q->whereRaw('1 = 0'));
    }

    /**
     * Confirmed events overlapping [from, to].
     *
     * @param  Builder<DocumentEvent>  $query
     */
    public function scopeConfirmedBetween(Builder $query, string $from, string $to): void
    {
        $query
            ->where('status', self::STATUS_CONFIRMED)
            ->where('starts_at', '<=', $to)
            ->whereRaw('COALESCE(ends_at, starts_at) >= ?', [$from]);
    }

    /** "Today" for calendar purposes, in the configured time zone. */
    public static function today(): Carbon
    {
        return Carbon::now(config('services.calendar.timezone'))->startOfDay();
    }

    /**
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'snippet' => $this->snippet,
            'page_number' => $this->page_number,
            'starts_at' => $this->starts_at?->toDateString(),
            'ends_at' => $this->ends_at?->toDateString(),
            'status' => $this->status,
            // Confirmed without a reviewer: the event was already over when
            // its document was indexed, so it went onto the calendar as history.
            'auto_confirmed' => $this->status === self::STATUS_CONFIRMED && $this->confirmed_by === null,
            'clearance_level' => $this->clearance_level,
            'document' => $this->document?->only(['id', 'title']),
            'department' => $this->department?->only(['id', 'name']),
        ];
    }
}
