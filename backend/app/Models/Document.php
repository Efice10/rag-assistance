<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Document extends Model
{
    use HasFactory;

    public const STATUS_PENDING = 'pending';

    public const STATUS_PROCESSING = 'processing';

    public const STATUS_INDEXED = 'indexed';

    public const STATUS_FAILED = 'failed';

    /** Held for administrator review: the text looked like a prompt-injection attempt. */
    public const STATUS_FLAGGED = 'flagged';

    public const CLEARANCE_LABELS = [
        1 => 'Public',
        2 => 'Internal',
        3 => 'Confidential',
        4 => 'Restricted',
    ];

    protected $fillable = [
        'organization_id',
        'department_id',
        'uploaded_by',
        'title',
        'file_path',
        'mime_type',
        'clearance_level',
        'status',
        'error_message',
        'version',
    ];

    protected function casts(): array
    {
        return [
            'clearance_level' => 'integer',
            'version' => 'integer',
            'pii_redactions' => 'integer',
            'superseded_at' => 'datetime',
            'approved_at' => 'datetime',
        ];
    }

    public function isSuperseded(): bool
    {
        return $this->superseded_at !== null;
    }

    /**
     * Earlier, still-current versions: same organization, department and
     * title (case-insensitive), lower version number.
     *
     * @return Builder<Document>
     */
    public function olderVersions(): Builder
    {
        return static::query()
            ->where('organization_id', $this->organization_id)
            ->where('department_id', $this->department_id)
            ->whereRaw('LOWER(title) = ?', [mb_strtolower($this->title)])
            ->where('version', '<', (int) ($this->version ?? 1))
            ->whereNull('superseded_at');
    }

    public static function nextVersionFor(int $organizationId, int $departmentId, string $title): int
    {
        return 1 + (int) static::query()
            ->where('organization_id', $organizationId)
            ->where('department_id', $departmentId)
            ->whereRaw('LOWER(title) = ?', [mb_strtolower($title)])
            ->max('version');
    }

    /**
     * Who may reindex, approve or otherwise manage a document: anyone allowed
     * to upload who can also see it.
     */
    public function manageableBy(User $user): bool
    {
        return $user->canUploadDocuments()
            && static::query()->visibleTo($user)->whereKey($this->id)->exists();
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function uploader(): BelongsTo
    {
        return $this->belongsTo(User::class, 'uploaded_by');
    }

    /**
     * The single definition of which documents a user may see. Mirrors the
     * WHERE clause the AI service applies to vector search.
     */
    public function scopeVisibleTo(Builder $query, User $user): void
    {
        $query
            ->where('organization_id', $user->organization_id)
            ->where('clearance_level', '<=', $user->clearance_level)
            ->when(! $user->isAdmin(), fn (Builder $q) => $q->where('department_id', $user->department_id));
    }

    /**
     * @return array<string, mixed>
     */
    public function toApiArray(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'mime_type' => $this->mime_type,
            'clearance_level' => $this->clearance_level,
            'clearance_label' => self::CLEARANCE_LABELS[$this->clearance_level] ?? 'Unknown',
            'status' => $this->status,
            'error_message' => $this->error_message,
            'version' => $this->version ?? 1,
            'superseded' => $this->isSuperseded(),
            'pii_redactions' => $this->pii_redactions ?? 0,
            'approved' => $this->approved_at !== null,
            'department' => $this->department?->only(['id', 'name']),
            'uploaded_by' => $this->uploader?->only(['id', 'name']),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
