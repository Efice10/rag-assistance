<?php

namespace App\Http\Controllers;

use App\Models\Conversation;
use App\Models\Message;
use App\Models\MessageFeedback;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A user's own chat history. Every lookup is filtered by user_id, so another
 * user's conversation (same organization or not, admin or not) answers 404.
 */
class ConversationController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $conversations = Conversation::query()
            ->where('user_id', $request->user()->id)
            ->orderByDesc('last_message_at')
            ->orderByDesc('id')
            ->limit(50)
            ->get();

        return response()->json(['data' => $conversations->map(fn (Conversation $c) => $c->summary())]);
    }

    public function show(Request $request, int $conversation): JsonResponse
    {
        $conversation = $this->own($request, $conversation);

        $messages = $conversation->messagesVisibleTo($request->user());
        $feedback = MessageFeedback::query()
            ->where('user_id', $request->user()->id)
            ->whereIn('message_id', $messages->pluck('id'))
            ->get()
            ->keyBy('message_id');

        return response()->json([
            'data' => [
                ...$conversation->summary(),
                'messages' => $messages->map(fn (Message $message) => $message->toChatArray($feedback[$message->id] ?? null)),
            ],
        ]);
    }

    public function destroy(Request $request, int $conversation): JsonResponse
    {
        // Messages go with it; the audit log keeps its own copy of each prompt.
        $this->own($request, $conversation)->delete();

        return response()->json(['message' => 'Conversation deleted.']);
    }

    private function own(Request $request, int $id): Conversation
    {
        return Conversation::query()
            ->where('user_id', $request->user()->id)
            ->findOrFail($id);
    }
}
