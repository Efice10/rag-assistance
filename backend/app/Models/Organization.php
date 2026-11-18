<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Organization extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'slug', 'event_reminder_days'];

    protected function casts(): array
    {
        return ['event_reminder_days' => 'integer'];
    }

    /** How far ahead the reminder banner looks (module 29). */
    public function reminderDays(): int
    {
        return (int) ($this->event_reminder_days ?? 7);
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function documents(): HasMany
    {
        return $this->hasMany(Document::class);
    }
}
