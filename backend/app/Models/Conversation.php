<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Conversation extends Model
{
    protected $fillable = ['organization_id', 'user_id', 'title', 'last_message_at'];

    protected function casts(): array
    {
        return ['last_message_at' => 'datetime'];
    }

    public static function titleFrom(string $prompt): string
    {
        return Str::limit(trim(preg_replace('/\s+/', ' ', $prompt)), 60);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class)->orderBy('id');
    }

    /**
     * The conversation's messages, re-checked against what the user may see
     * now. An answer that cited a document the user can no longer access (a
     * lowered clearance, a department move, a deleted document) is withheld,
     * so saved history never outlives the RBAC rule.
     *
     * @return Collection<int, Message>
     */
    public function messagesVisibleTo(User $user): Collection
    {
        $messages = $this->messages()->get();

        $cited = $messages->pluck('sources')->flatten(1)->pluck('document_id')->filter()->unique();
        $visible = Document::query()->visibleTo($user)->whereIn('id', $cited)->pluck('id')->flip();

        return $messages->each(function (Message $message) use ($visible) {
            $hidden = collect($message->sources)->contains(fn ($source) => ! isset($visible[$source['document_id'] ?? 0]));

            if ($hidden) {
                $message->content = Message::WITHHELD;
                $message->sources = [];
                $message->withheld = true;
            }
        });
    }

    /**
     * The last turns, oldest first, for follow-up questions. Sources, failed
     * turns and withheld answers are left out: only words the user may still
     * see go back to the model.
     *
     * @return list<array{role: string, content: string}>
     */
    public function recentHistory(User $user, int $limit = 6): array
    {
        return $this->messagesVisibleTo($user)
            ->reject(fn (Message $message) => $message->error !== null || $message->withheld)
            ->take(-$limit)
            ->map(fn (Message $message) => [
                'role' => $message->role,
                'content' => Str::limit($message->content, 1000),
            ])
            ->values()
            ->all();
    }

    /**
     * @return array<string, mixed>
     */
    public function summary(): array
    {
        return [
            'id' => $this->id,
            'title' => $this->title,
            'last_message_at' => ($this->last_message_at ?? $this->created_at)?->toIso8601String(),
        ];
    }
}
