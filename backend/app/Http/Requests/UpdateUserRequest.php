<?php

namespace App\Http\Requests;

use App\Models\User;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Illuminate\Validation\Validator;

class UpdateUserRequest extends FormRequest
{
    public function authorize(): Response
    {
        return Gate::inspect('update', $this->target());
    }

    public function rules(): array
    {
        $actor = $this->user();

        return [
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'email' => ['sometimes', 'required', 'string', 'email', 'max:255', Rule::unique('users', 'email')->ignore($this->target())],
            // Leave blank to keep the current password.
            'password' => ['sometimes', 'nullable', 'string', Password::min(8)],
            'role' => ['sometimes', 'required', Rule::in(User::ROLES)],
            'department_id' => ['sometimes', 'required', 'integer', StoreUserRequest::departmentRule($actor)],
            'clearance_level' => ['sometimes', 'required', 'integer', 'min:1', 'max:'.$actor->clearance_level],
        ];
    }

    public function messages(): array
    {
        return StoreUserRequest::sharedMessages();
    }

    /**
     * An administrator cannot change their own role. Together with the rule
     * that nobody can deactivate themselves, this means the acting admin is
     * always still an active admin afterwards, so an organization can never
     * lose its last administrator through this API.
     *
     * @return list<callable(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator) {
                if ($this->target()->is($this->user()) && $this->has('role') && $this->input('role') !== $this->user()->role) {
                    $validator->errors()->add('role', 'You cannot change your own role.');
                }
            },
        ];
    }

    public function target(): User
    {
        return $this->route('user');
    }
}
