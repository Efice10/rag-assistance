<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class AuditLog extends Model
{
    public const UPDATED_AT = null;

    public const ACTION_CHAT_QUERY = 'chat.query';

    public const ACTION_CHAT_QUERY_FAILED = 'chat.query_failed';

    public const ACTION_USER_CREATED = 'user.created';

    public const ACTION_USER_UPDATED = 'user.updated';

    public const ACTION_USER_DEACTIVATED = 'user.deactivated';

    public const ACTION_USER_REACTIVATED = 'user.reactivated';

    public const ACTION_DEPARTMENT_CREATED = 'department.created';

    public const ACTION_DEPARTMENT_RENAMED = 'department.renamed';

    public const ACTION_DOCUMENT_APPROVED = 'document.approved';

    public const ACTION_SSO_UPDATED = 'sso.updated';

    public const ACTION_USER_PROVISIONED = 'user.provisioned';

    public const ACTION_EVENT_CONFIRMED = 'event.confirmed';

    public const ACTION_EVENT_REJECTED = 'event.rejected';

    public const ACTION_SETTINGS_UPDATED = 'settings.updated';

    protected $fillable = [
        'organization_id',
        'user_id',
        'action',
        'prompt',
        'retrieved_document_ids',
        'ip_address',
    ];

    protected function casts(): array
    {
        return [
            'retrieved_document_ids' => 'array',
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        // Append-only. Database triggers enforce the same rule for raw queries.
        static::updating(fn () => throw new LogicException('Audit logs are immutable and cannot be updated.'));
        static::deleting(fn () => throw new LogicException('Audit logs are immutable and cannot be deleted.'));
    }

    /**
     * Record an administrative change. The description goes in the `prompt`
     * column so the audit page shows it in the same place as chat prompts.
     */
    public static function recordAdminAction(User $actor, string $action, string $description, ?string $ipAddress): self
    {
        return static::create([
            'organization_id' => $actor->organization_id,
            'user_id' => $actor->id,
            'action' => $action,
            'prompt' => $description,
            'retrieved_document_ids' => [],
            'ip_address' => $ipAddress,
        ]);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
