<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Message extends Model
{
    public const UPDATED_AT = null;

    public const ROLE_USER = 'user';

    public const ROLE_ASSISTANT = 'assistant';

    public const WITHHELD = 'This answer cited documents you can no longer access, so it is hidden.';

    protected $fillable = ['conversation_id', 'role', 'content', 'sources', 'error'];

    /** Set (never saved) when the content is hidden by Conversation::messagesVisibleTo(). */
    public bool $withheld = false;

    protected function casts(): array
    {
        return [
            'sources' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function feedback(): HasMany
    {
        return $this->hasMany(MessageFeedback::class);
    }

    /**
     * @return array<string, mixed>
     */
    public function toChatArray(?MessageFeedback $feedback = null): array
    {
        return [
            'id' => $this->id,
            'role' => $this->role,
            'content' => $this->content,
            'sources' => $this->sources ?? [],
            'error' => $this->error,
            'withheld' => $this->withheld,
            'created_at' => $this->created_at?->toIso8601String(),
            'feedback' => $feedback ? ['helpful' => $feedback->helpful, 'comment' => $feedback->comment] : null,
        ];
    }
}
