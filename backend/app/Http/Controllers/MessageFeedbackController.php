<?php

namespace App\Http\Controllers;

use App\Models\Message;
use App\Models\MessageFeedback;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class MessageFeedbackController extends Controller
{
    /**
     * Rate an assistant answer in one of the user's own conversations.
     * Rating again replaces the earlier rating.
     */
    public function store(Request $request, int $message): JsonResponse
    {
        $user = $request->user();

        $message = Message::query()
            ->where('role', Message::ROLE_ASSISTANT)
            ->whereHas('conversation', fn ($query) => $query->where('user_id', $user->id))
            ->findOrFail($message);

        $data = $request->validate([
            'helpful' => ['required', 'boolean'],
            'comment' => ['nullable', 'string', 'max:1000'],
        ]);

        $feedback = MessageFeedback::updateOrCreate(
            ['message_id' => $message->id, 'user_id' => $user->id],
            [
                'organization_id' => $user->organization_id,
                'helpful' => $data['helpful'],
                'comment' => filled($data['comment'] ?? null) ? trim($data['comment']) : null,
            ],
        );

        return response()->json([
            'data' => ['helpful' => $feedback->helpful, 'comment' => $feedback->comment],
        ], $feedback->wasRecentlyCreated ? 201 : 200);
    }
}
