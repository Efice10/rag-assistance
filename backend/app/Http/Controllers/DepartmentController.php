<?php

namespace App\Http\Controllers;

use App\Http\Requests\SaveDepartmentRequest;
use App\Models\AuditLog;
use App\Models\Department;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class DepartmentController extends Controller
{
    /**
     * Departments the user may file documents under: all of their
     * organization's for admins (with user and document counts), only their
     * own for everyone else.
     */
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();

        $departments = Department::query()
            ->where('organization_id', $user->organization_id)
            ->when(! $user->isAdmin(), fn ($query) => $query->whereKey($user->department_id))
            ->when($user->isAdmin(), fn ($query) => $query->withCount(['users', 'documents']))
            ->orderBy('name')
            ->get();

        return response()->json([
            'data' => $departments->map(fn (Department $department) => $this->row($department)),
        ]);
    }

    public function store(SaveDepartmentRequest $request): JsonResponse
    {
        $department = Department::create([
            'organization_id' => $request->user()->organization_id,
            'name' => $request->validated('name'),
        ]);

        AuditLog::recordAdminAction(
            $request->user(),
            AuditLog::ACTION_DEPARTMENT_CREATED,
            "Created department {$department->name}",
            $request->ip(),
        );

        return response()->json(['data' => $this->row($department->loadCount(['users', 'documents']))], 201);
    }

    public function update(SaveDepartmentRequest $request, Department $department): JsonResponse
    {
        $previous = $department->name;
        $department->update(['name' => $request->validated('name')]);

        if ($department->wasChanged('name')) {
            AuditLog::recordAdminAction(
                $request->user(),
                AuditLog::ACTION_DEPARTMENT_RENAMED,
                "Renamed department {$previous} → {$department->name}",
                $request->ip(),
            );
        }

        return response()->json(['data' => $this->row($department->loadCount(['users', 'documents']))]);
    }

    /**
     * @return array<string, mixed>
     */
    private function row(Department $department): array
    {
        return array_filter([
            'id' => $department->id,
            'name' => $department->name,
            'users_count' => $department->users_count,
            'documents_count' => $department->documents_count,
        ], fn ($value) => $value !== null);
    }
}
