<?php

namespace App\Http\Controllers;

use App\Http\Requests\ChatRequest;
use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\User;
use App\Services\AiServiceClient;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Throwable;

class ChatController extends Controller
{
    public function __invoke(ChatRequest $request, AiServiceClient $ai): StreamedResponse
    {
        $user = $request->user();
        $prompt = $request->validated('prompt');
        $ipAddress = $request->ip();

        // Trusted, server-derived scope. Nothing from the request body is used.
        $scope = $user->retrievalScope();

        // ChatRequest only accepts a conversation the user owns.
        $conversation = $request->validated('conversation_id')
            ? Conversation::findOrFail($request->validated('conversation_id'))
            : null;
        $history = $conversation?->recentHistory($user) ?? [];

        return response()->stream(function () use ($ai, $user, $prompt, $scope, $ipAddress, $conversation, $history) {
            // Keep running if the browser disconnects, so the audit record is always written.
            ignore_user_abort(true);

            $documentIds = [];
            $sources = [];
            $answer = '';
            $error = null;
            $action = AuditLog::ACTION_CHAT_QUERY;

            try {
                $body = $ai->streamQuery($prompt, $scope, $history);
                $buffer = '';

                while (! $body->eof()) {
                    $chunk = $body->read(1024);

                    if ($chunk === '') {
                        continue;
                    }

                    $this->send($chunk);

                    // Watch the stream as it passes through, for the history and audit rows.
                    $buffer .= str_replace("\r\n", "\n", $chunk);

                    while (($end = strpos($buffer, "\n\n")) !== false) {
                        [$event, $data] = $this->parse(substr($buffer, 0, $end));
                        $buffer = substr($buffer, $end + 2);

                        if ($event === 'token') {
                            $answer .= (string) ($data['text'] ?? '');
                        } elseif ($event === 'sources') {
                            $sources = $this->validSources($data['sources'] ?? []);
                        } elseif ($event === 'error') {
                            // The AI service reports its own failures as an error event.
                            $action = AuditLog::ACTION_CHAT_QUERY_FAILED;
                            $error = (string) ($data['message'] ?? 'The assistant could not complete this request.');
                        }
                    }
                }

                $documentIds = array_column($sources, 'document_id');
            } catch (Throwable $e) {
                report($e);
                $action = AuditLog::ACTION_CHAT_QUERY_FAILED;
                $error = 'The AI service is unavailable. Please try again shortly.';

                $this->send("event: error\ndata: ".json_encode(['message' => $error])."\n\n");
            } finally {
                // One insert, after the stream ends: audit_logs rows are never updated.
                AuditLog::create([
                    'organization_id' => $user->organization_id,
                    'user_id' => $user->id,
                    'action' => $action,
                    'prompt' => $prompt,
                    'retrieved_document_ids' => array_values(array_unique($documentIds)),
                    'ip_address' => $ipAddress,
                ]);
            }

            try {
                $saved = $this->saveTurn($user, $conversation, $prompt, $answer, $sources, $error);

                // Laravel's own event, after the relayed stream: where this turn was saved.
                $this->send("event: saved\ndata: ".json_encode($saved)."\n\n");
            } catch (Throwable $e) {
                report($e);
            }
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache, no-transform',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * @param  list<array{document_id: int, document_title: string, page_number: int}>  $sources
     * @return array{conversation_id: int, title: string, message_id: int}
     */
    private function saveTurn(User $user, ?Conversation $conversation, string $prompt, string $answer, array $sources, ?string $error): array
    {
        $conversation ??= Conversation::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'title' => Conversation::titleFrom($prompt),
        ]);

        $conversation->messages()->create(['role' => Message::ROLE_USER, 'content' => $prompt]);
        $reply = $conversation->messages()->create([
            'role' => Message::ROLE_ASSISTANT,
            'content' => $answer,
            'sources' => $sources,
            'error' => $error,
        ]);

        $conversation->update(['last_message_at' => now()]);

        return ['conversation_id' => $conversation->id, 'title' => $conversation->title, 'message_id' => $reply->id];
    }

    private function send(string $data): void
    {
        echo $data;

        if (ob_get_level() > 0) {
            @ob_flush();
        }

        flush();
    }

    /**
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function parse(string $rawEvent): array
    {
        $event = preg_match('/^event:\s*(\S+)\s*$/m', $rawEvent, $name) ? $name[1] : 'message';
        $data = preg_match('/^data:\s*(.+)$/m', $rawEvent, $match) ? json_decode($match[1], true) : null;

        return [$event, is_array($data) ? $data : []];
    }

    /**
     * @return list<array{document_id: int, document_title: string, page_number: int}>
     */
    private function validSources(mixed $sources): array
    {
        return collect(is_array($sources) ? $sources : [])
            ->filter(fn ($source) => is_array($source) && is_numeric($source['document_id'] ?? null))
            ->map(fn (array $source) => [
                'document_id' => (int) $source['document_id'],
                'document_title' => (string) ($source['document_title'] ?? ''),
                'page_number' => (int) ($source['page_number'] ?? 1),
            ])
            ->values()
            ->all();
    }
}
