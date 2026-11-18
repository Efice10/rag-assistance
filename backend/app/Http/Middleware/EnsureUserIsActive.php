<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Deactivation revokes a user's tokens, but this check also stops any token
 * that slipped through (for example one issued during the same request).
 */
class EnsureUserIsActive
{
    public function handle(Request $request, Closure $next): Response
    {
        $user = $request->user();

        if ($user && ! $user->isActive()) {
            $user->currentAccessToken()?->delete();

            abort(401, 'This account has been deactivated.');
        }

        return $next($request);
    }
}
