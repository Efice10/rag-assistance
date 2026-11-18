<?php

use App\Models\AuditLog;
use App\Models\Conversation;
use App\Models\Document;
use App\Models\Message;
use App\Models\MessageFeedback;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    config(['services.ai.secret' => 'test-internal-secret']);
    $this->t = tenants();
    $this->manager = User::factory()->in($this->t['procurement'])->manager(3)->create();
    $this->colleague = User::factory()->in($this->t['procurement'])->manager(3)->create();
    $this->admin = User::factory()->in($this->t['hr'])->admin()->create();
    $this->outsider = User::factory()->in($this->t['operations'])->admin()->create();
    $this->confidential = Document::factory()->in($this->t['procurement'])->create(['clearance_level' => 3]);
});

function conversationFor(User $user, array $messages = []): Conversation
{
    $conversation = Conversation::create([
        'organization_id' => $user->organization_id,
        'user_id' => $user->id,
        'title' => 'Earlier chat',
        'last_message_at' => now(),
    ]);

    foreach ($messages as $message) {
        $conversation->messages()->create($message);
    }

    return $conversation;
}

describe('saving chat turns', function () {
    it('creates a conversation on the first prompt and reports where it was saved', function () {
        Http::fake(['*/query' => Http::response(fakeAiStream([$this->confidential->id], 'Three quotes.'), 200)]);
        Sanctum::actingAs($this->manager);

        $content = $this->postJson('/api/chat', ['prompt' => 'How many quotations do I need for a big purchase?'])
            ->assertOk()->streamedContent();

        $conversation = Conversation::sole();
        expect($conversation->user_id)->toBe($this->manager->id)
            ->and($conversation->title)->toBe('How many quotations do I need for a big purchase?');

        [$question, $answer] = $conversation->messages()->get()->all();
        expect($question->role)->toBe('user')
            ->and($answer->content)->toBe('Three quotes.')
            ->and($answer->sources)->toBe([['document_id' => $this->confidential->id, 'document_title' => "Document {$this->confidential->id}", 'page_number' => 1]]);

        // The relayed stream is unchanged, then Laravel adds one `saved` event.
        expect($content)->toStartWith("event: token\n")
            ->toContain("event: saved\ndata: ".json_encode(['conversation_id' => $conversation->id, 'title' => $conversation->title, 'message_id' => $answer->id]));
        expect(AuditLog::sole()->action)->toBe(AuditLog::ACTION_CHAT_QUERY);
    });

    it('appends follow-ups and sends the earlier turns, without sources, to the AI service', function () {
        $conversation = conversationFor($this->manager, [
            ['role' => 'user', 'content' => 'What is the purchase limit?'],
            ['role' => 'assistant', 'content' => 'RM 10,000 [SOP, Page 2].', 'sources' => [['document_id' => $this->confidential->id, 'document_title' => 'SOP', 'page_number' => 2]]],
        ]);
        Http::fake(['*/query' => Http::response(fakeAiStream(), 200)]);
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/chat', ['prompt' => 'What about under RM 500?', 'conversation_id' => $conversation->id])
            ->assertOk()->streamedContent();

        expect($conversation->messages()->count())->toBe(4)
            ->and(Conversation::count())->toBe(1);

        Http::assertSent(fn ($request) => $request['history'] === [
            ['role' => 'user', 'content' => 'What is the purchase limit?'],
            ['role' => 'assistant', 'content' => 'RM 10,000 [SOP, Page 2].'],
        ] && $request['clearance_level'] === 3);
    });

    it('records a failed turn with its error and keeps it out of later history', function () {
        Http::fake(['*/query' => Http::response('boom', 500)]);
        Sanctum::actingAs($this->manager);

        $this->postJson('/api/chat', ['prompt' => 'Anything?'])->assertOk()->streamedContent();

        $reply = Message::where('role', 'assistant')->sole();
        expect($reply->error)->toBe('The AI service is unavailable. Please try again shortly.')
            ->and(Conversation::sole()->recentHistory($this->manager))->toBe([['role' => 'user', 'content' => 'Anything?']]);
    });

    it('refuses to continue another user conversation', function (string $who) {
        $conversation = conversationFor($this->manager);
        Http::fake();
        Sanctum::actingAs($this->{$who});

        $this->postJson('/api/chat', ['prompt' => 'Continue please', 'conversation_id' => $conversation->id])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('conversation_id');

        Http::assertNothingSent();
    })->with(['colleague', 'admin', 'outsider']);
});

describe('reading history', function () {
    it('lists only the user own conversations, newest first', function () {
        $old = conversationFor($this->manager);
        $old->update(['last_message_at' => now()->subDay()]);
        $new = conversationFor($this->manager);
        conversationFor($this->colleague);
        Sanctum::actingAs($this->manager);

        expect(collect($this->getJson('/api/conversations')->assertOk()->json('data'))->pluck('id')->all())
            ->toBe([$new->id, $old->id]);
    });

    it('answers 404 for anyone else, admins included', function (string $who) {
        $conversation = conversationFor($this->manager, [['role' => 'user', 'content' => 'Secret question']]);
        Sanctum::actingAs($this->{$who});

        $this->getJson("/api/conversations/{$conversation->id}")->assertNotFound();
        $this->deleteJson("/api/conversations/{$conversation->id}")->assertNotFound();

        expect($conversation->fresh())->not->toBeNull();
    })->with(['colleague', 'admin', 'outsider']);

    it('round-trips messages and sources', function () {
        $sources = [['document_id' => $this->confidential->id, 'document_title' => 'SOP', 'page_number' => 4]];
        $conversation = conversationFor($this->manager, [
            ['role' => 'user', 'content' => 'Q'],
            ['role' => 'assistant', 'content' => 'A', 'sources' => $sources],
        ]);
        Sanctum::actingAs($this->manager);

        $this->getJson("/api/conversations/{$conversation->id}")
            ->assertOk()
            ->assertJsonPath('data.messages.1.sources', $sources)
            ->assertJsonPath('data.messages.1.withheld', false);
    });

    it('withholds saved answers that cite documents the user can no longer access', function () {
        $conversation = conversationFor($this->manager, [
            ['role' => 'user', 'content' => 'What does the confidential SOP say?'],
            ['role' => 'assistant', 'content' => 'The confidential limit is RM 50,000.', 'sources' => [['document_id' => $this->confidential->id, 'document_title' => 'SOP', 'page_number' => 1]]],
        ]);
        // An administrator lowers the manager's clearance below the document's.
        $this->manager->update(['clearance_level' => 2]);
        Sanctum::actingAs($this->manager);

        $this->getJson("/api/conversations/{$conversation->id}")
            ->assertOk()
            ->assertJsonPath('data.messages.1.content', Message::WITHHELD)
            ->assertJsonPath('data.messages.1.sources', [])
            ->assertJsonPath('data.messages.1.withheld', true)
            ->assertDontSee('RM 50,000');

        // Nor does the withheld text go back to the model as history.
        Http::fake(['*/query' => Http::response(fakeAiStream(), 200)]);
        $this->postJson('/api/chat', ['prompt' => 'And the limit again?', 'conversation_id' => $conversation->id])
            ->assertOk()->streamedContent();
        Http::assertSent(fn ($request) => ! str_contains(json_encode($request['history']), 'RM 50,000'));
    });

    it('deletes the user own conversation and its messages, but not the audit log', function () {
        Http::fake(['*/query' => Http::response(fakeAiStream(), 200)]);
        Sanctum::actingAs($this->manager);
        $this->postJson('/api/chat', ['prompt' => 'Delete me later'])->assertOk()->streamedContent();
        $conversation = Conversation::sole();

        $this->deleteJson("/api/conversations/{$conversation->id}")->assertOk();

        expect(Conversation::count())->toBe(0)
            ->and(Message::count())->toBe(0)
            ->and(AuditLog::sole()->prompt)->toBe('Delete me later');
    });
});

describe('answer feedback', function () {
    beforeEach(function () {
        $conversation = conversationFor($this->manager, [
            ['role' => 'user', 'content' => 'Q'],
            ['role' => 'assistant', 'content' => 'A'],
        ]);
        [$this->question, $this->answer] = $conversation->messages()->get()->all();
    });

    it('records a rating and replaces it when the user rates again', function () {
        Sanctum::actingAs($this->manager);

        $this->postJson("/api/messages/{$this->answer->id}/feedback", ['helpful' => false, 'comment' => 'Wrong page'])->assertCreated();
        $this->postJson("/api/messages/{$this->answer->id}/feedback", ['helpful' => true])->assertOk()
            ->assertJsonPath('data.helpful', true)
            ->assertJsonPath('data.comment', null);

        expect(MessageFeedback::sole())
            ->helpful->toBeTrue()
            ->organization_id->toBe($this->t['acme']->id);

        $this->getJson("/api/conversations/{$this->answer->conversation_id}")
            ->assertJsonPath('data.messages.1.feedback.helpful', true);
    });

    it('only accepts ratings on assistant answers in the user own conversations', function () {
        Sanctum::actingAs($this->colleague);
        $this->postJson("/api/messages/{$this->answer->id}/feedback", ['helpful' => true])->assertNotFound();

        Sanctum::actingAs($this->manager);
        $this->postJson("/api/messages/{$this->question->id}/feedback", ['helpful' => true])->assertNotFound();
        $this->postJson("/api/messages/{$this->answer->id}/feedback", ['helpful' => 'maybe'])->assertUnprocessable();

        expect(MessageFeedback::count())->toBe(0);
    });
});
