<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SsoConnection extends Model
{
    protected $fillable = [
        'organization_id',
        'enabled',
        'issuer',
        'client_id',
        'client_secret',
        'email_domain',
        'default_department_id',
        'default_role',
        'default_clearance_level',
    ];

    protected $hidden = ['client_secret'];

    protected function casts(): array
    {
        return [
            'enabled' => 'boolean',
            'client_secret' => 'encrypted',
            'default_clearance_level' => 'integer',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function defaultDepartment(): BelongsTo
    {
        return $this->belongsTo(Department::class, 'default_department_id');
    }

    public static function domainOf(string $email): string
    {
        return mb_strtolower(trim((string) substr(strrchr($email, '@') ?: '', 1)));
    }

    /**
     * @return array<string, mixed>
     */
    public function toAdminArray(): array
    {
        return [
            'enabled' => $this->enabled,
            'issuer' => $this->issuer,
            'client_id' => $this->client_id,
            'has_client_secret' => filled($this->getRawOriginal('client_secret')),
            'email_domain' => $this->email_domain,
            'default_department_id' => $this->default_department_id,
            'default_role' => $this->default_role,
            'default_clearance_level' => $this->default_clearance_level,
            'redirect_uri' => config('services.sso.redirect_uri'),
        ];
    }
}
