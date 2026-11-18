<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;
use Illuminate\Validation\Rules\Password;

class StoreUserRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('create', User::class);
    }

    public function rules(): array
    {
        $actor = $this->user();

        return [
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'string', 'email', 'max:255', Rule::unique('users', 'email')],
            'password' => ['required', 'string', Password::min(8)],
            'role' => ['required', Rule::in(User::ROLES)],
            'department_id' => ['required', 'integer', self::departmentRule($actor)],
            // Nobody can grant a clearance above their own.
            'clearance_level' => ['required', 'integer', 'min:1', 'max:'.$actor->clearance_level],
        ];
    }

    public function messages(): array
    {
        return self::sharedMessages();
    }

    public static function departmentRule(User $actor): Exists
    {
        return Rule::exists('departments', 'id')->where('organization_id', $actor->organization_id);
    }

    /**
     * @return array<string, string>
     */
    public static function sharedMessages(): array
    {
        return [
            'department_id.exists' => 'Choose a department in your organization.',
            'clearance_level.max' => 'You cannot grant a clearance level above your own.',
            'email.unique' => 'Another account already uses this email address.',
        ];
    }
}
