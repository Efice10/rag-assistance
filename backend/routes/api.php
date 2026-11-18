<?php

use App\Http\Controllers\AuditLogController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\ChatController;
use App\Http\Controllers\DepartmentController;
use App\Http\Controllers\DocumentController;
use App\Http\Controllers\UserController;
use Illuminate\Support\Facades\Route;

Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:10,1');

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

    // 20 prompts per minute per user, counted in the cache store (Redis locally).
    Route::post('/chat', ChatController::class)->middleware('throttle:20,1');

    Route::get('/audit-logs', [AuditLogController::class, 'index']);
});
