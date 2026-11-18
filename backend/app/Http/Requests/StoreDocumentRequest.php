<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreDocumentRequest extends FormRequest
{
    /** Stored mime type per accepted extension. */
    public const MIME_TYPES = [
        'pdf' => 'application/pdf',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt' => 'text/plain',
        'md' => 'text/markdown',
    ];

    /**
     * What fileinfo may report for those files. Office formats are zip
     * containers, and Markdown is usually detected as plain text.
     */
    private const DETECTED_TYPES = [
        'application/pdf',
        'application/zip',
        'application/octet-stream',
        'text/plain',
        'text/markdown',
        'text/x-markdown',
        self::MIME_TYPES['docx'],
        self::MIME_TYPES['xlsx'],
        self::MIME_TYPES['pptx'],
    ];

    public function authorize(): bool
    {
        return $this->user()->canUploadDocuments();
    }

    public function rules(): array
    {
        $user = $this->user();

        // Admins may file a document under any department in their own
        // organization; managers only under their own department.
        $departmentRule = Rule::exists('departments', 'id')
            ->where('organization_id', $user->organization_id);

        if (! $user->isAdmin()) {
            $departmentRule->where('id', $user->department_id);
        }

        return [
            'title' => ['required', 'string', 'max:255'],
            'department_id' => ['required', 'integer', $departmentRule],
            // Nobody can classify a document above their own clearance.
            'clearance_level' => ['required', 'integer', 'min:1', 'max:'.$user->clearance_level],
            'file' => [
                'required',
                'file',
                'max:20480',
                'extensions:'.implode(',', array_keys(self::MIME_TYPES)),
                'mimetypes:'.implode(',', self::DETECTED_TYPES),
            ],
        ];
    }

    public function messages(): array
    {
        return [
            'department_id.exists' => 'You cannot upload documents to that department.',
            'clearance_level.max' => 'You cannot classify a document above your own clearance level.',
            'file.extensions' => 'Accepted formats: PDF, DOCX, XLSX, PPTX, TXT and MD.',
            'file.mimetypes' => 'Accepted formats: PDF, DOCX, XLSX, PPTX, TXT and MD.',
        ];
    }
}
