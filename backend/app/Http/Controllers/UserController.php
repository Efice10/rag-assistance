<?php

namespace App\Http\Controllers;

use App\Http\Requests\StoreUserRequest;
use App\Http\Requests\UpdateUserRequest;
use App\Models\AuditLog;
use App\Models\Department;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Laravel\Sanctum\PersonalAccessToken;

/**
 * Admin user management. Every change is written to the audit log. A
 * changed role, department or clearance applies from the user's next
 * request, because the retrieval scope is rebuilt from the user row each time.
 */
class UserController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        Gate::authorize('viewAny', User::class);

        $search = trim((string) $request->query('q', ''));

        $users = User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->when($search !== '', function ($query) use ($search) {
                $term = '%'.mb_strtolower($search).'%';

                $query->where(fn ($inner) => $inner
                    ->whereRaw('LOWER(name) LIKE ?', [$term])
                    ->orWhereRaw('LOWER(email) LIKE ?', [$term]));
            })
            ->with('department:id,name')
            ->orderByRaw('CASE WHEN deactivated_at IS NULL THEN 0 ELSE 1 END')
            ->orderBy('name')
            ->paginate(20);

        return response()->json([
            'data' => $users->getCollection()->map(fn (User $user) => $user->managementRow()),
            'meta' => [
                'current_page' => $users->currentPage(),
                'last_page' => $users->lastPage(),
                'per_page' => $users->perPage(),
                'total' => $users->total(),
            ],
        ]);
    }

    public function store(StoreUserRequest $request): JsonResponse
    {
        $actor = $request->user();

        $user = new User($request->validated());
        $user->organization_id = $actor->organization_id;
        $user->email_verified_at = now();
        $user->save();

        AuditLog::recordAdminAction(
            $actor,
            AuditLog::ACTION_USER_CREATED,
            sprintf(
                'Created %s as %s in %s with clearance L%d',
                $this->label($user),
                $user->role,
                $user->department->name,
                $user->clearance_level,
            ),
            $request->ip(),
        );

        return response()->json(['data' => $user->managementRow()], 201);
    }

    public function update(UpdateUserRequest $request, User $user): JsonResponse
    {
        $data = $request->validated();

        if (blank($data['password'] ?? null)) {
            unset($data['password']);
        }

        $before = $user->only(['name', 'email', 'role', 'clearance_level', 'department_id']);
        $user->fill($data);
        $passwordChanged = $user->isDirty('password');
        $changes = $this->describeChanges($before, $user->getDirty());

        if ($changes === []) {
            return response()->json(['data' => $user->managementRow()]);
        }

        $user->save();

        // A password reset signs the user out everywhere, except the admin
        // resetting their own password in this session.
        if ($passwordChanged) {
            $current = $request->user()->currentAccessToken();

            $user->tokens()
                ->when($current instanceof PersonalAccessToken, fn ($tokens) => $tokens->whereKeyNot($current->getKey()))
                ->delete();
        }

        AuditLog::recordAdminAction(
            $request->user(),
            AuditLog::ACTION_USER_UPDATED,
            'Updated '.$this->label($user).': '.implode('; ', $changes),
            $request->ip(),
        );

        return response()->json(['data' => $user->unsetRelation('department')->managementRow()]);
    }

    public function deactivate(Request $request, User $user): JsonResponse
    {
        Gate::authorize('deactivate', $user);

        if ($user->isActive()) {
            $user->forceFill(['deactivated_at' => now()])->save();
            $user->tokens()->delete();

            AuditLog::recordAdminAction(
                $request->user(),
                AuditLog::ACTION_USER_DEACTIVATED,
                'Deactivated '.$this->label($user),
                $request->ip(),
            );
        }

        return response()->json(['data' => $user->managementRow()]);
    }

    public function reactivate(Request $request, User $user): JsonResponse
    {
        Gate::authorize('reactivate', $user);

        if (! $user->isActive()) {
            $user->forceFill(['deactivated_at' => null])->save();

            AuditLog::recordAdminAction(
                $request->user(),
                AuditLog::ACTION_USER_REACTIVATED,
                'Reactivated '.$this->label($user),
                $request->ip(),
            );
        }

        return response()->json(['data' => $user->managementRow()]);
    }

    private function label(User $user): string
    {
        return "{$user->name} <{$user->email}>";
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $dirty
     * @return list<string>
     */
    private function describeChanges(array $before, array $dirty): array
    {
        $changes = [];

        foreach ($dirty as $field => $value) {
            $changes[] = match ($field) {
                'password' => 'password reset',
                'department_id' => sprintf(
                    'department %s → %s',
                    Department::find($before['department_id'])?->name ?? '?',
                    Department::find($value)?->name ?? '?',
                ),
                'clearance_level' => "clearance L{$before['clearance_level']} → L{$value}",
                default => "{$field} {$before[$field]} → {$value}",
            };
        }

        return $changes;
    }
}
