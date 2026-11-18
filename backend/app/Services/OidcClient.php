<?php

namespace App\Services;

use App\Models\SsoConnection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use RuntimeException;

/**
 * A minimal OpenID Connect client (authorization code flow with PKCE).
 *
 * The code is exchanged server-to-server with the client secret over TLS,
 * and the identity is read from the provider's userinfo endpoint with the
 * resulting access token. Because both calls go directly to the provider,
 * the ID token's signature does not need to be checked here.
 */
class OidcClient
{
    /**
     * @return array{authorization_endpoint: string, token_endpoint: string, userinfo_endpoint: string}
     */
    public function discover(SsoConnection $connection): array
    {
        $issuer = rtrim($connection->issuer, '/');
        $this->assertSecure($issuer);

        return Cache::remember('oidc:discovery:'.sha1($issuer), 3600, function () use ($issuer) {
            $document = Http::timeout(10)->acceptJson()
                ->get($issuer.'/.well-known/openid-configuration')
                ->throw()
                ->json();

            // OIDC Discovery 1.0, section 4.3: the issuer must match exactly.
            if (rtrim((string) ($document['issuer'] ?? ''), '/') !== $issuer) {
                throw new RuntimeException('The identity provider reported a different issuer.');
            }

            $endpoints = [];
            foreach (['authorization_endpoint', 'token_endpoint', 'userinfo_endpoint'] as $key) {
                $endpoints[$key] = (string) ($document[$key] ?? '');
                $this->assertSecure($endpoints[$key]);
            }

            return $endpoints;
        });
    }

    public function authorizationUrl(SsoConnection $connection, string $state, string $nonce, string $verifier, string $loginHint): string
    {
        $endpoints = $this->discover($connection);

        return $endpoints['authorization_endpoint'].'?'.http_build_query([
            'response_type' => 'code',
            'client_id' => $connection->client_id,
            'redirect_uri' => config('services.sso.redirect_uri'),
            'scope' => 'openid email profile',
            'state' => $state,
            'nonce' => $nonce,
            'login_hint' => $loginHint,
            'code_challenge' => self::challenge($verifier),
            'code_challenge_method' => 'S256',
        ]);
    }

    /**
     * Exchange the code and return the userinfo claims.
     *
     * @return array<string, mixed>
     */
    public function identity(SsoConnection $connection, string $code, string $verifier): array
    {
        $endpoints = $this->discover($connection);

        $tokens = Http::asForm()->timeout(15)->acceptJson()
            ->post($endpoints['token_endpoint'], [
                'grant_type' => 'authorization_code',
                'code' => $code,
                'redirect_uri' => config('services.sso.redirect_uri'),
                'client_id' => $connection->client_id,
                'client_secret' => $connection->client_secret,
                'code_verifier' => $verifier,
            ])
            ->throw()
            ->json();

        $accessToken = (string) ($tokens['access_token'] ?? '');
        if ($accessToken === '') {
            throw new RuntimeException('The identity provider returned no access token.');
        }

        return Http::withToken($accessToken)->timeout(10)->acceptJson()
            ->get($endpoints['userinfo_endpoint'])
            ->throw()
            ->json() ?? [];
    }

    public static function challenge(string $verifier): string
    {
        return rtrim(strtr(base64_encode(hash('sha256', $verifier, true)), '+/', '-_'), '=');
    }

    private function assertSecure(string $url): void
    {
        $scheme = parse_url($url, PHP_URL_SCHEME);

        if ($scheme === 'https') {
            return;
        }

        $host = parse_url($url, PHP_URL_HOST);
        $local = in_array($host, ['localhost', '127.0.0.1'], true);

        if (! ($scheme === 'http' && $local && config('services.sso.allow_insecure_issuers'))) {
            throw new RuntimeException('Identity provider URLs must use HTTPS.');
        }
    }
}
