<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class MessageFeedback extends Model
{
    protected $table = 'message_feedback';

    protected $fillable = ['organization_id', 'message_id', 'user_id', 'helpful', 'comment'];

    protected function casts(): array
    {
        return ['helpful' => 'boolean'];
    }

    public function message(): BelongsTo
    {
        return $this->belongsTo(Message::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
