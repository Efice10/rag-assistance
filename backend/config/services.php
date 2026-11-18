<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Resend, Postmark, AWS, and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // The FastAPI AI service (ai-service/). Internal only; never exposed to browsers.
    'ai' => [
        'url' => env('AI_SERVICE_URL', 'http://127.0.0.1:8001'),
        'secret' => env('INTERNAL_API_SECRET'),
        'ingest_timeout' => env('AI_INGEST_TIMEOUT', 900),
        'query_timeout' => env('AI_QUERY_TIMEOUT', 300),
    ],

    // Event calendar (module 29). The app stores timestamps in UTC; "today"
    // for events (date-only, all-day) is taken in this time zone instead.
    'calendar' => [
        'timezone' => env('CALENDAR_TIMEZONE', 'Asia/Kuala_Lumpur'),
    ],

    // OpenID Connect sign-in. Per-organization provider settings live in the
    // sso_connections table; the identity provider sends the browser back to
    // this frontend page, which hands the code to /api/sso/callback.
    'sso' => [
        'redirect_uri' => env('SSO_REDIRECT_URI', 'http://localhost:3000/sso/callback'),
        // Development identity providers on http://localhost are allowed only when this is true.
        'allow_insecure_issuers' => (bool) env('SSO_ALLOW_INSECURE_ISSUERS', false),
    ],

];
