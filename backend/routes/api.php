<?php

use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DepartmentController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\MessageFeedbackController;
use App\Http\Controllers\MetricsController;
use App\Http\Controllers\OrganizationSettingsController;
use App\Http\Controllers\ProcessingController;
use App\Http\Controllers\SsoController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');
Route::post('/sso/start', [SsoController::class, 'start'])->middleware('throttle:10,1');
Route::post('/sso/callback', [SsoController::class, 'callback'])->middleware('throttle:10,1');

Route::middleware(['auth:sanctum', 'active'])->group(function () {
    Route::post('/logout', [AuthController::class, 'logout']);
    Route::get('/me', [AuthController::class, 'me']);

    Route::get('/departments', [DepartmentController::class, 'index']);
    Route::post('/departments', [DepartmentController::class, 'store']);
    Route::put('/departments/{department}', [DepartmentController::class, 'update'])->whereNumber('department');

    // Admin user management (authorization in UserPolicy).
    Route::get('/users', [UserController::class, 'index']);
    Route::post('/users', [UserController::class, 'store']);
    Route::put('/users/{user}', [UserController::class, 'update'])->whereNumber('user');
    Route::put('/users/{user}/deactivate', [UserController::class, 'deactivate'])->whereNumber('user');
    Route::put('/users/{user}/reactivate', [UserController::class, 'reactivate'])->whereNumber('user');

    Route::get('/documents', [DocumentController::class, 'index']);
    Route::post('/documents', [DocumentController::class, 'store']);
    Route::get('/documents/{document}/download', [DocumentController::class, 'download'])
        ->whereNumber('document');
    Route::get('/documents/{document}/preview', [DocumentController::class, 'preview'])->whereNumber('document');
    Route::post('/documents/{document}/reindex', [DocumentController::class, 'reindex'])->whereNumber('document');
    Route::post('/documents/{document}/approve', [DocumentController::class, 'approve'])->whereNumber('document');

    // 20 prompts per minute per user, counted in the cache store (Redis locally).
    Route::post('/chat', ChatController::class)->middleware('throttle:20,1');

    // Event calendar (module 29).
    Route::get('/events', [EventController::class, 'index']);
    Route::get('/events/upcoming', [EventController::class, 'upcoming']);
    Route::get('/events/pending', [EventController::class, 'pending']);
    Route::post('/events/{event}/dismiss', [EventController::class, 'dismiss'])->whereNumber('event');
    Route::post('/events/{event}/confirm', [EventController::class, 'confirm'])->whereNumber('event');
    Route::post('/events/{event}/reject', [EventController::class, 'reject'])->whereNumber('event');

    // The user's own chat history and answer ratings.
    Route::get('/conversations', [ConversationController::class, 'index']);
    Route::get('/conversations/{conversation}', [ConversationController::class, 'show'])->whereNumber('conversation');
    Route::delete('/conversations/{conversation}', [ConversationController::class, 'destroy'])->whereNumber('conversation');
    Route::post('/messages/{message}/feedback', [MessageFeedbackController::class, 'store'])->whereNumber('message');

    Route::get('/audit-logs', [AuditLogController::class, 'index']);
    Route::get('/audit-logs/export', [AuditLogController::class, 'export']);

    // Admin views.
    Route::get('/admin/metrics', MetricsController::class);
    Route::get('/admin/settings', [OrganizationSettingsController::class, 'show']);
    Route::put('/admin/settings', [OrganizationSettingsController::class, 'update']);
    Route::get('/admin/sso', [SsoController::class, 'showSettings']);
    Route::put('/admin/sso', [SsoController::class, 'updateSettings']);
    Route::get('/admin/processing', [ProcessingController::class, 'index']);
    Route::post('/admin/failed-jobs/{failedJob}/retry', [ProcessingController::class, 'retry'])->whereNumber('failedJob');
    Route::delete('/admin/failed-jobs/{failedJob}', [ProcessingController::class, 'forget'])->whereNumber('failedJob');
});
