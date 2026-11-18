<?php

namespace App\Services;

use Illuminate\Http\Client\PendingRequest;
use Illuminate\Support\Facades\Http;
use Psr\Http\Message\StreamInterface;

/**
 * The only place Laravel talks to the FastAPI AI service.
 */
class AiServiceClient
{
    /**
     * Index a document. Blocks until the AI service has finished chunking and
     * embedding, which can take minutes for large files.
     *
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    public function ingest(array $payload): array
    {
        return $this->request()
            ->timeout((int) config('services.ai.ingest_timeout'))
            ->post('/ingest', $payload)
            ->throw()
            ->json() ?? [];
    }

    /**
     * Start a retrieval query and return the raw Server-Sent Events body.
     *
     * @param  array{organization_id: int, department_id: int, clearance_level: int, is_admin: bool}  $scope
     * @param  list<array{role: string, content: string}>  $history  earlier turns of the user's own conversation
     */
    public function streamQuery(string $prompt, array $scope, array $history = []): StreamInterface
    {
        return $this->request()
            ->timeout((int) config('services.ai.query_timeout'))
            ->withOptions(['stream' => true])
            ->post('/query', ['prompt' => $prompt, ...$scope, 'history' => $history])
            ->throw()
            ->toPsrResponse()
            ->getBody();
    }

    /**
     * The text of a stored file, page by page, for the in-app viewer.
     *
     * @return array{pages: list<array{page: int, text: string}>, truncated: bool}
     */
    public function preview(string $absolutePath): array
    {
        return $this->request()
            ->timeout(60)
            ->post('/preview', ['file_path' => $absolutePath])
            ->throw()
            ->json();
    }

    private function request(): PendingRequest
    {
        return Http::baseUrl(rtrim((string) config('services.ai.url'), '/'))
            ->withHeaders(['X-Internal-Secret' => (string) config('services.ai.secret')])
            ->connectTimeout(5)
            ->acceptJson()
            ->asJson();
    }
}
