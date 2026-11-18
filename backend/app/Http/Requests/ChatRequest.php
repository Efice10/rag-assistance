<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class ChatRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * Only the prompt and, for a follow-up, the user's own conversation id are
     * accepted. Scope fields such as organization_id or clearance_level are
     * deliberately not validated, so they never reach validated() even if a
     * client sends them.
     */
    public function rules(): array
    {
        return [
            'prompt' => ['required', 'string', 'min:2', 'max:2000'],
            'conversation_id' => [
                'nullable',
                'integer',
                Rule::exists('conversations', 'id')->where('user_id', $this->user()->id),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'conversation_id.exists' => 'That conversation was not found.',
        ];
    }
}
