<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use App\Models\SsoConnection;
use App\Models\User;
use App\Services\OidcClient;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;
use Throwable;

/**
 * Single sign-on through each organization's OpenID Connect provider.
 * Password sign-in keeps working alongside it (for break-glass access).
 */
class SsoController extends Controller
{
    private const STATE_TTL_MINUTES = 10;

    /**
     * Step 1: find the organization's provider from the email domain and
     * return the URL to send the browser to.
     */
    public function start(Request $request, OidcClient $oidc): JsonResponse
    {
        $email = $request->validate(['email' => ['required', 'email']])['email'];

        $connection = SsoConnection::query()
            ->where('email_domain', SsoConnection::domainOf($email))
            ->where('enabled', true)
            ->first();

        if (! $connection) {
            throw ValidationException::withMessages(['email' => ['Single sign-on is not set up for this email domain. Sign in with your password.']]);
        }

        $state = Str::random(40);
        $nonce = Str::random(40);
        $verifier = Str::random(64);

        try {
            $url = $oidc->authorizationUrl($connection, $state, $nonce, $verifier, $email);
        } catch (Throwable $e) {
            report($e);
            throw ValidationException::withMessages(['email' => ['Your organization\'s identity provider could not be reached. Try again or sign in with your password.']]);
        }

        Cache::put("sso:state:{$state}", [
            'connection_id' => $connection->id,
            'verifier' => $verifier,
        ], now()->addMinutes(self::STATE_TTL_MINUTES));

        return response()->json(['authorization_url' => $url]);
    }

    /**
     * Step 2: the provider sent the browser back with a code. Exchange it,
     * check the identity against the connection, then sign the user in,
     * creating their account on first use.
     */
    public function callback(Request $request, OidcClient $oidc): JsonResponse
    {
        $data = $request->validate(['code' => ['required', 'string'], 'state' => ['required', 'string']]);

        // One use only: a replayed or forged state finds nothing.
        $pending = Cache::pull("sso:state:{$data['state']}");
        $connection = $pending ? SsoConnection::query()->where('enabled', true)->find($pending['connection_id']) : null;

        if (! $connection) {
            return $this->refuse('This sign-in link has expired. Start again.');
        }

        try {
            $claims = $oidc->identity($connection, $data['code'], $pending['verifier']);
        } catch (Throwable $e) {
            report($e);

            return $this->refuse('Your identity provider did not confirm the sign-in. Start again.');
        }

        $email = mb_strtolower(trim((string) ($claims['email'] ?? '')));
        $subject = (string) ($claims['sub'] ?? '');

        if ($subject === '' || $email === '' || ($claims['email_verified'] ?? false) !== true) {
            return $this->refuse('Your identity provider did not share a verified email address.');
        }

        if (SsoConnection::domainOf($email) !== $connection->email_domain) {
            return $this->refuse('That account is not part of this organization.');
        }

        $user = User::query()->whereRaw('LOWER(email) = ?', [$email])->first();

        // An existing account in another organization is never taken over,
        // and an account already linked to a different SSO identity is refused.
        if ($user && ($user->organization_id !== $connection->organization_id
            || ($user->sso_subject !== null && ! hash_equals($user->sso_subject, $subject)))) {
            return $this->refuse('That account cannot sign in through this identity provider.');
        }

        if ($user && ! $user->isActive()) {
            return $this->refuse('This account has been deactivated. Contact your administrator.');
        }

        if (! $user) {
            $user = $this->provision($connection, $email, $subject, $claims, $request->ip());
        } elseif ($user->sso_subject === null) {
            $user->forceFill(['sso_subject' => $subject])->save();
        }

        return response()->json([
            'token' => $user->createToken('sso')->plainTextToken,
            'user' => $user->profile(),
        ]);
    }

    public function showSettings(Request $request): JsonResponse
    {
        $user = $this->admin($request);
        $connection = SsoConnection::where('organization_id', $user->organization_id)->first();

        return response()->json(['data' => $connection?->toAdminArray(), 'redirect_uri' => config('services.sso.redirect_uri')]);
    }

    public function updateSettings(Request $request): JsonResponse
    {
        $user = $this->admin($request);
        $existing = SsoConnection::where('organization_id', $user->organization_id)->first();

        $data = $request->validate([
            'enabled' => ['required', 'boolean'],
            'issuer' => ['required', 'url', 'max:255'],
            'client_id' => ['required', 'string', 'max:255'],
            // Write-only: leave blank to keep the stored secret.
            'client_secret' => [$existing ? 'nullable' : 'required', 'string', 'max:2000'],
            'email_domain' => [
                'required', 'string', 'max:255', 'regex:/^[a-z0-9.-]+\.[a-z]{2,}$/i',
                Rule::unique('sso_connections', 'email_domain')->ignore($existing),
            ],
            'default_department_id' => ['required', 'integer', Rule::exists('departments', 'id')->where('organization_id', $user->organization_id)],
            // New accounts never start as administrators.
            'default_role' => ['required', Rule::in([User::ROLE_STAFF, User::ROLE_MANAGER])],
            'default_clearance_level' => ['required', 'integer', 'min:1', 'max:'.min(2, $user->clearance_level)],
        ], [
            'email_domain.unique' => 'Another organization already uses this email domain for sign-in.',
            'default_clearance_level.max' => 'New accounts can start at Public or Internal clearance at most; raise it per user afterwards.',
        ]);

        $data['email_domain'] = mb_strtolower($data['email_domain']);
        if (blank($data['client_secret'] ?? null)) {
            unset($data['client_secret']);
        }

        $connection = SsoConnection::updateOrCreate(['organization_id' => $user->organization_id], $data);
        Cache::forget('oidc:discovery:'.sha1(rtrim($connection->issuer, '/')));

        AuditLog::recordAdminAction(
            $user,
            AuditLog::ACTION_SSO_UPDATED,
            sprintf('Single sign-on %s for @%s via %s', $connection->enabled ? 'enabled' : 'disabled', $connection->email_domain, $connection->issuer),
            $request->ip(),
        );

        return response()->json(['data' => $connection->toAdminArray()]);
    }

    /**
     * @param  array<string, mixed>  $claims
     */
    private function provision(SsoConnection $connection, string $email, string $subject, array $claims, ?string $ip): User
    {
        $user = new User([
            'name' => Str::limit(trim((string) ($claims['name'] ?? '')) ?: Str::before($email, '@'), 255, ''),
            'email' => $email,
            // Unusable random password: this account signs in through SSO
            // until an administrator sets a password for it.
            'password' => Str::random(64),
            'role' => $connection->default_role,
            'department_id' => $connection->default_department_id,
            'clearance_level' => $connection->default_clearance_level,
        ]);
        $user->organization_id = $connection->organization_id;
        $user->sso_subject = $subject;
        $user->email_verified_at = now();
        $user->save();

        AuditLog::recordAdminAction(
            $user,
            AuditLog::ACTION_USER_PROVISIONED,
            sprintf('Account created by single sign-on for %s <%s> as %s with clearance L%d', $user->name, $email, $user->role, $user->clearance_level),
            $ip,
        );

        return $user;
    }

    private function refuse(string $message): JsonResponse
    {
        return response()->json(['message' => $message], 403);
    }

    private function admin(Request $request): User
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only administrators can configure single sign-on.');

        return $request->user();
    }
}
