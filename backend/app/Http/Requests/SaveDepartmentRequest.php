<?php

namespace App\Http\Requests;

use App\Models\Department;
use Illuminate\Auth\Access\Response;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Creating or renaming a department: administrators only, inside their own
 * organization. A department from another organization answers 404.
 */
class SaveDepartmentRequest extends FormRequest
{
    public function authorize(): Response
    {
        $department = $this->department();

        if ($department && $department->organization_id !== $this->user()->organization_id) {
            return Response::denyAsNotFound();
        }

        return $this->user()->isAdmin()
            ? Response::allow()
            : Response::deny('Only administrators can manage departments.');
    }

    public function rules(): array
    {
        return [
            'name' => [
                'required',
                'string',
                'max:100',
                Rule::unique('departments', 'name')
                    ->where('organization_id', $this->user()->organization_id)
                    ->ignore($this->department()),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'name.unique' => 'Your organization already has a department with this name.',
        ];
    }

    public function department(): ?Department
    {
        return $this->route('department');
    }
}
