<?php

namespace App\Http\Controllers;

use App\Models\AuditLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Organization-wide settings, for administrators. */
class OrganizationSettingsController extends Controller
{
    public function show(Request $request): JsonResponse
    {
        $organization = $this->organization($request);

        return response()->json(['data' => ['event_reminder_days' => $organization->reminderDays()]]);
    }

    public function update(Request $request): JsonResponse
    {
        $organization = $this->organization($request);

        $data = $request->validate([
            'event_reminder_days' => ['required', 'integer', 'min:1', 'max:60'],
        ]);

        $before = $organization->reminderDays();
        $organization->update($data);

        if ($before !== $organization->reminderDays()) {
            AuditLog::recordAdminAction(
                $request->user(),
                AuditLog::ACTION_SETTINGS_UPDATED,
                "Event reminders look ahead {$before} → {$organization->reminderDays()} days",
                $request->ip(),
            );
        }

        return response()->json(['data' => ['event_reminder_days' => $organization->reminderDays()]]);
    }

    private function organization(Request $request)
    {
        abort_unless($request->user()->isAdmin(), 403, 'Only administrators can change organization settings.');

        return $request->user()->organization;
    }
}
