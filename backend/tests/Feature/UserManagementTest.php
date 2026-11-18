<?php

use App\Models\AuditLog;
use App\Models\Department;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    $this->t = tenants();
    $this->admin = User::factory()->in($this->t['procurement'])->admin()->create(['email' => 'admin@acme.test']);
    $this->manager = User::factory()->in($this->t['procurement'])->manager(3)->create();
    $this->staff = User::factory()->in($this->t['hr'])->staff(1)->create();
    $this->globexAdmin = User::factory()->in($this->t['operations'])->admin()->create();
    $this->globexStaff = User::factory()->in($this->t['operations'])->staff(2)->create();
});

function newUserPayload(array $overrides = []): array
{
    return array_merge([
        'name' => 'New Person',
        'email' => 'new.person@acme.test',
        'password' => 'secret-pass',
        'role' => 'staff',
        'department_id' => test()->t['hr']->id,
        'clearance_level' => 2,
    ], $overrides);
}

describe('access control', function () {
    it('forbids managers and staff from every user-management route', function (string $who) {
        Sanctum::actingAs($this->{$who});
        $target = $this->staff->is($this->{$who}) ? $this->manager : $this->staff;

        $this->getJson('/api/users')->assertForbidden();
        $this->postJson('/api/users', newUserPayload())->assertForbidden();
        $this->putJson("/api/users/{$target->id}", ['name' => 'X'])->assertForbidden();
        $this->putJson("/api/users/{$target->id}/deactivate")->assertForbidden();
        $this->putJson("/api/users/{$target->id}/reactivate")->assertForbidden();
        $this->postJson('/api/departments', ['name' => 'Legal'])->assertForbidden();
        $this->putJson("/api/departments/{$this->t['hr']->id}", ['name' => 'People'])->assertForbidden();

        expect(User::where('email', 'new.person@acme.test')->exists())->toBeFalse()
            ->and(AuditLog::count())->toBe(0);
    })->with(['manager', 'staff']);

    it('lists only users of the admin organization', function () {
        Sanctum::actingAs($this->admin);

        $emails = collect($this->getJson('/api/users')->assertOk()->json('data'))->pluck('email');

        expect($emails)->toHaveCount(3)
            ->toContain($this->admin->email, $this->manager->email, $this->staff->email)
            ->not->toContain($this->globexAdmin->email, $this->globexStaff->email);
    });

    it('answers 404 when an admin touches a user of another organization', function () {
        Sanctum::actingAs($this->admin);
        $id = $this->globexStaff->id;

        $this->putJson("/api/users/{$id}", ['clearance_level' => 4])->assertNotFound();
        $this->putJson("/api/users/{$id}/deactivate")->assertNotFound();
        $this->putJson("/api/users/{$id}/reactivate")->assertNotFound();

        expect($this->globexStaff->fresh())
            ->clearance_level->toBe(2)
            ->isActive()->toBeTrue();
    });

    it('answers 404 when an admin renames a department of another organization', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/departments/{$this->t['operations']->id}", ['name' => 'Hijacked'])->assertNotFound();

        expect($this->t['operations']->fresh()->name)->toBe('Operations');
    });
});

describe('creating users', function () {
    it('creates a user in the admin organization and audits it', function () {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', newUserPayload())
            ->assertCreated()
            ->assertJsonPath('data.email', 'new.person@acme.test')
            ->assertJsonPath('data.department.name', 'Human Resources')
            ->assertJsonPath('data.active', true)
            ->assertJsonMissingPath('data.password');

        $user = User::where('email', 'new.person@acme.test')->firstOrFail();
        expect($user->organization_id)->toBe($this->t['acme']->id);

        $log = AuditLog::sole();
        expect($log->action)->toBe(AuditLog::ACTION_USER_CREATED)
            ->and($log->user_id)->toBe($this->admin->id)
            ->and($log->prompt)->toContain('new.person@acme.test', 'Human Resources', 'L2');

        // The new account can sign in with the password the admin set.
        $this->postJson('/api/login', ['email' => 'new.person@acme.test', 'password' => 'secret-pass'])->assertOk();
    });

    it('ignores an organization_id sent by the client', function () {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', newUserPayload(['organization_id' => $this->t['globex']->id]))->assertCreated();

        expect(User::where('email', 'new.person@acme.test')->value('organization_id'))->toBe($this->t['acme']->id);
    });

    it('rejects a department from another organization', function () {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', newUserPayload(['department_id' => $this->t['operations']->id]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('department_id');
    });

    it('bounds clearance between 1 and the admin own level', function (int $level) {
        $limitedAdmin = User::factory()->in($this->t['procurement'])->create(['role' => 'admin', 'clearance_level' => 3]);
        Sanctum::actingAs($limitedAdmin);

        $this->postJson('/api/users', newUserPayload(['clearance_level' => $level]))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('clearance_level');
    })->with([0, 4, 5]);

    it('rejects a duplicate email, an unknown role and a short password', function () {
        Sanctum::actingAs($this->admin);

        $this->postJson('/api/users', newUserPayload(['email' => $this->globexStaff->email, 'role' => 'owner', 'password' => 'short']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['email', 'role', 'password']);
    });
});

describe('updating users', function () {
    it('changes role, department and clearance, and the new scope applies at once', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->staff->id}", [
            'role' => 'manager',
            'department_id' => $this->t['procurement']->id,
            'clearance_level' => 3,
        ])->assertOk()->assertJsonPath('data.department.name', 'Procurement');

        expect($this->staff->fresh()->retrievalScope())->toBe([
            'organization_id' => $this->t['acme']->id,
            'department_id' => $this->t['procurement']->id,
            'clearance_level' => 3,
            'is_admin' => false,
        ]);

        expect(AuditLog::sole()->prompt)
            ->toContain('role staff → manager', 'department Human Resources → Procurement', 'clearance L1 → L3');
    });

    it('writes no audit row when nothing changed', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->staff->id}", ['name' => $this->staff->name, 'password' => ''])->assertOk();

        expect(AuditLog::count())->toBe(0);
    });

    it('signs the user out everywhere after a password reset', function () {
        $this->staff->createToken('web');
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->staff->id}", ['password' => 'brand-new-pass'])->assertOk();

        expect($this->staff->tokens()->count())->toBe(0)
            ->and(AuditLog::sole()->prompt)->toContain('password reset')
            ->not->toContain('brand-new-pass');
    });

    it('does not let an admin change their own role', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->admin->id}", ['role' => 'staff'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('role');

        expect($this->admin->fresh()->role)->toBe('admin');
    });

    it('lets an admin edit their own name', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->admin->id}", ['name' => 'Alice A.', 'role' => 'admin'])->assertOk();

        expect($this->admin->fresh()->name)->toBe('Alice A.');
    });
});

describe('deactivation', function () {
    it('deactivates a user, revokes their tokens and audits it', function () {
        $token = $this->staff->createToken('web')->plainTextToken;
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->staff->id}/deactivate")
            ->assertOk()
            ->assertJsonPath('data.active', false);

        expect($this->staff->fresh()->isActive())->toBeFalse()
            ->and($this->staff->tokens()->count())->toBe(0)
            ->and(AuditLog::sole()->action)->toBe(AuditLog::ACTION_USER_DEACTIVATED);

        // The user row still exists, so their audit history keeps a name.
        expect(User::whereKey($this->staff->id)->exists())->toBeTrue();

        app('auth')->forgetGuards();
        $this->withToken($token)->getJson('/api/me')->assertUnauthorized();
    });

    it('refuses sign-in for a deactivated account', function () {
        $this->staff->forceFill(['deactivated_at' => now()])->save();

        $this->postJson('/api/login', ['email' => $this->staff->email, 'password' => 'password'])
            ->assertUnprocessable()
            ->assertJsonPath('errors.email.0', 'This account has been deactivated. Contact your administrator.');
    });

    it('rejects a deactivated user even with a token that still exists', function () {
        Sanctum::actingAs(User::factory()->in($this->t['hr'])->deactivated()->create());

        $this->getJson('/api/documents')->assertUnauthorized();
        $this->postJson('/api/chat', ['prompt' => 'Anything?'])->assertUnauthorized();
    });

    it('does not let an admin deactivate themselves', function () {
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->admin->id}/deactivate")->assertForbidden();

        expect($this->admin->fresh()->isActive())->toBeTrue();
    });

    it('keeps at least one active admin: the acting admin always remains', function () {
        $second = User::factory()->in($this->t['hr'])->admin()->create();
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$second->id}/deactivate")->assertOk();
        $this->putJson("/api/users/{$this->admin->id}", ['role' => 'manager'])->assertUnprocessable();

        expect(User::where('organization_id', $this->t['acme']->id)->where('role', 'admin')->active()->count())->toBe(1);
    });

    it('reactivates a user and is idempotent', function () {
        $this->staff->forceFill(['deactivated_at' => now()])->save();
        Sanctum::actingAs($this->admin);

        $this->putJson("/api/users/{$this->staff->id}/reactivate")->assertOk()->assertJsonPath('data.active', true);
        $this->putJson("/api/users/{$this->staff->id}/reactivate")->assertOk();

        expect(AuditLog::where('action', AuditLog::ACTION_USER_REACTIVATED)->count())->toBe(1);
        $this->postJson('/api/login', ['email' => $this->staff->email, 'password' => 'password'])->assertOk();
    });
});

describe('departments', function () {
    it('creates and renames departments, unique within the organization', function () {
        Sanctum::actingAs($this->admin);

        $id = $this->postJson('/api/departments', ['name' => 'Legal'])
            ->assertCreated()
            ->assertJsonPath('data.users_count', 0)
            ->json('data.id');

        expect(Department::find($id)->organization_id)->toBe($this->t['acme']->id);

        $this->postJson('/api/departments', ['name' => 'Human Resources'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('name');

        // Another organization's department name is free to reuse.
        $this->postJson('/api/departments', ['name' => 'Operations'])->assertCreated();

        $this->putJson("/api/departments/{$id}", ['name' => 'Legal & Risk'])
            ->assertOk()
            ->assertJsonPath('data.name', 'Legal & Risk');

        expect(AuditLog::pluck('action')->all())->toBe([
            AuditLog::ACTION_DEPARTMENT_CREATED,
            AuditLog::ACTION_DEPARTMENT_CREATED,
            AuditLog::ACTION_DEPARTMENT_RENAMED,
        ]);
    });

    it('gives admins user counts and keeps the plain list for everyone else', function () {
        Sanctum::actingAs($this->admin);
        $rows = collect($this->getJson('/api/departments')->assertOk()->json('data'))->keyBy('name');
        expect($rows['Procurement']['users_count'])->toBe(2)
            ->and($rows['Human Resources']['users_count'])->toBe(1);

        Sanctum::actingAs($this->manager);
        $this->getJson('/api/departments')
            ->assertOk()
            ->assertExactJson(['data' => [['id' => $this->t['procurement']->id, 'name' => 'Procurement']]]);
    });
});
