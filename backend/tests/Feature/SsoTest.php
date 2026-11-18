<?php

use App\Models\AuditLog;
use App\Models\SsoConnection;
use App\Models\User;
use App\Services\OidcClient;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;

const ISSUER = 'https://idp.acme.test';

beforeEach(function () {
    $this->t = tenants();
    $this->admin = User::factory()->in($this->t['procurement'])->admin()->create(['email' => 'admin@acme.test']);
    $this->connection = SsoConnection::create([
        'organization_id' => $this->t['acme']->id,
        'enabled' => true,
        'issuer' => ISSUER,
        'client_id' => 'rag-client',
        'client_secret' => 'super-secret',
        'email_domain' => 'acme.test',
        'default_department_id' => $this->t['hr']->id,
        'default_role' => 'staff',
        'default_clearance_level' => 1,
    ]);
});

/**
 * Fake the identity provider: discovery, token exchange and userinfo.
 *
 * @param  array<string, mixed>  $claims
 */
function fakeIdp(array $claims, string $issuer = ISSUER): void
{
    Http::fake([
        "{$issuer}/.well-known/openid-configuration" => Http::response([
            'issuer' => $issuer,
            'authorization_endpoint' => "{$issuer}/authorize",
            'token_endpoint' => "{$issuer}/token",
            'userinfo_endpoint' => "{$issuer}/userinfo",
        ]),
        "{$issuer}/token" => Http::response(['access_token' => 'idp-access-token', 'token_type' => 'Bearer']),
        "{$issuer}/userinfo" => Http::response($claims),
    ]);
}

/** Run step 1 and return the state the provider would echo back. */
function startSso(string $email = 'nina@acme.test'): string
{
    $url = test()->postJson('/api/sso/start', ['email' => $email])->assertOk()->json('authorization_url');
    parse_str(parse_url($url, PHP_URL_QUERY), $query);

    return $query['state'];
}

function claims(array $overrides = []): array
{
    return array_merge(['sub' => 'idp-user-1', 'email' => 'nina@acme.test', 'email_verified' => true, 'name' => 'Nina New'], $overrides);
}

describe('sign-in flow', function () {
    it('builds a PKCE authorization request for the organization provider', function () {
        fakeIdp(claims());

        $url = $this->postJson('/api/sso/start', ['email' => 'Nina@Acme.test'])->assertOk()->json('authorization_url');
        parse_str(parse_url($url, PHP_URL_QUERY), $query);

        expect($url)->toStartWith(ISSUER.'/authorize?')
            ->and($query)->toMatchArray([
                'response_type' => 'code',
                'client_id' => 'rag-client',
                'redirect_uri' => config('services.sso.redirect_uri'),
                'code_challenge_method' => 'S256',
                'scope' => 'openid email profile',
            ])
            ->and($query['state'])->toHaveLength(40)
            ->and($url)->not->toContain('super-secret');
    });

    it('provisions a first-time user with the connection defaults and audits it', function () {
        fakeIdp(claims());
        $state = startSso();

        $response = $this->postJson('/api/sso/callback', ['code' => 'auth-code', 'state' => $state])
            ->assertOk()
            ->assertJsonPath('user.email', 'nina@acme.test')
            ->assertJsonPath('user.role', 'staff')
            ->assertJsonPath('user.clearance_level', 1)
            ->assertJsonPath('user.department.name', 'Human Resources')
            ->assertJsonPath('user.organization.slug', 'acme');

        $this->withToken($response->json('token'))->getJson('/api/me')->assertOk();

        expect(User::where('email', 'nina@acme.test')->sole()->sso_subject)->toBe('idp-user-1')
            ->and(AuditLog::sole()->action)->toBe(AuditLog::ACTION_USER_PROVISIONED);

        // The code was exchanged server-side with the secret and the PKCE verifier.
        Http::assertSent(fn ($request) => $request->url() === ISSUER.'/token'
            && $request['client_secret'] === 'super-secret'
            && strlen($request['code_verifier']) === 64
            && $request['code'] === 'auth-code');
    });

    it('signs an existing user in and links the identity, without changing their access', function () {
        $existing = User::factory()->in($this->t['procurement'])->manager(3)->create(['email' => 'nina@acme.test']);
        fakeIdp(claims());

        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso()])
            ->assertOk()
            ->assertJsonPath('user.id', $existing->id)
            ->assertJsonPath('user.clearance_level', 3);

        expect($existing->fresh()->sso_subject)->toBe('idp-user-1')
            ->and(User::count())->toBe(2)
            ->and(AuditLog::count())->toBe(0);
    });

    it('refuses a replayed or unknown state', function () {
        fakeIdp(claims());
        $state = startSso();

        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => $state])->assertOk();
        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => $state])->assertForbidden();
        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => 'forged'])->assertForbidden();
    });

    it('says when a domain has no SSO, or SSO is disabled', function () {
        $this->postJson('/api/sso/start', ['email' => 'someone@globex.test'])->assertUnprocessable()->assertJsonValidationErrors('email');

        $this->connection->update(['enabled' => false]);
        $this->postJson('/api/sso/start', ['email' => 'nina@acme.test'])->assertUnprocessable();
    });
});

describe('identity checks', function () {
    it('refuses unverified or missing email claims', function (array $override) {
        fakeIdp(claims($override));

        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso()])->assertForbidden();

        expect(User::count())->toBe(1);
    })->with([
        'unverified' => [['email_verified' => false]],
        'verification missing' => [['email_verified' => null]],
        'no email' => [['email' => '']],
        'no subject' => [['sub' => '']],
    ]);

    it('refuses an identity from another email domain', function () {
        fakeIdp(claims(['email' => 'mallory@evil.test']));

        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso()])->assertForbidden();

        expect(User::where('email', 'mallory@evil.test')->exists())->toBeFalse();
    });

    it('never takes over an account in another organization', function () {
        // Globex owns this address; Acme's provider asserts it.
        $foreign = User::factory()->in($this->t['operations'])->admin()->create(['email' => 'cfo@acme.test']);
        fakeIdp(claims(['email' => 'cfo@acme.test']));

        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso('cfo@acme.test')])->assertForbidden();

        expect($foreign->fresh()->sso_subject)->toBeNull();
    });

    it('refuses an account linked to a different identity, and deactivated accounts', function () {
        $linked = User::factory()->in($this->t['hr'])->create(['email' => 'nina@acme.test', 'sso_subject' => 'someone-else']);
        fakeIdp(claims());
        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso()])->assertForbidden();

        $linked->forceFill(['sso_subject' => 'idp-user-1', 'deactivated_at' => now()])->save();
        $this->postJson('/api/sso/callback', ['code' => 'c', 'state' => startSso()])
            ->assertForbidden()
            ->assertJsonPath('message', 'This account has been deactivated. Contact your administrator.');
    });

    it('refuses a provider whose discovery document names a different issuer', function () {
        Http::fake([ISSUER.'/.well-known/openid-configuration' => Http::response([
            'issuer' => 'https://attacker.test',
            'authorization_endpoint' => 'https://attacker.test/authorize',
            'token_endpoint' => 'https://attacker.test/token',
            'userinfo_endpoint' => 'https://attacker.test/userinfo',
        ])]);

        $this->postJson('/api/sso/start', ['email' => 'nina@acme.test'])->assertUnprocessable();
    });

    it('computes the S256 code challenge per RFC 7636', function () {
        expect(OidcClient::challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'))
            ->toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
});

describe('admin settings', function () {
    it('shows settings to admins without the secret', function () {
        Sanctum::actingAs($this->admin);

        $this->getJson('/api/admin/sso')
            ->assertOk()
            ->assertJsonPath('data.has_client_secret', true)
            ->assertJsonPath('data.email_domain', 'acme.test')
            ->assertJsonMissingPath('data.client_secret')
            ->assertDontSee('super-secret');
    });

    it('updates settings, keeps a blank secret, and audits the change', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/admin/sso', [
            'enabled' => false,
            'issuer' => 'https://login.acme.test',
            'client_id' => 'new-client',
            'client_secret' => '',
            'email_domain' => 'ACME.test',
            'default_department_id' => $this->t['procurement']->id,
            'default_role' => 'manager',
            'default_clearance_level' => 2,
        ])->assertOk()->assertJsonPath('data.client_id', 'new-client');

        expect($this->connection->fresh())
            ->client_secret->toBe('super-secret')
            ->email_domain->toBe('acme.test')
            ->enabled->toBeFalse();
        expect(AuditLog::sole()->action)->toBe(AuditLog::ACTION_SSO_UPDATED);
    });

    it('rejects admin defaults, high default clearance and foreign departments', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson('/api/admin/sso', [
            'enabled' => true,
            'issuer' => ISSUER,
            'client_id' => 'x',
            'email_domain' => 'acme.test',
            'default_department_id' => $this->t['operations']->id,
            'default_role' => 'admin',
            'default_clearance_level' => 4,
        ])->assertUnprocessable()->assertJsonValidationErrors(['default_department_id', 'default_role', 'default_clearance_level']);
    });

    it('does not let two organizations claim the same email domain', function () {
        $globexAdmin = User::factory()->in($this->t['operations'])->admin()->create();
        Sanctum::actingAs($globexAdmin);

        $this->putJson('/api/admin/sso', [
            'enabled' => true,
            'issuer' => 'https://idp.globex.test',
            'client_id' => 'x',
            'client_secret' => 'y',
            'email_domain' => 'acme.test',
            'default_department_id' => $this->t['operations']->id,
            'default_role' => 'staff',
            'default_clearance_level' => 1,
        ])->assertUnprocessable()->assertJsonValidationErrors('email_domain');
    });

    it('is admin-only', function () {
        Sanctum::actingAs(User::factory()->in($this->t['procurement'])->manager()->create());

        $this->getJson('/api/admin/sso')->assertForbidden();
        $this->putJson('/api/admin/sso', [])->assertForbidden();
    });
});
