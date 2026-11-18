<?php

namespace App\Policies;

use App\Models\User;
use Illuminate\Auth\Access\Response;

/**
 * User management is for administrators, inside their own organization only.
 * A user from another organization answers 404, so ids cannot be probed.
 */
class UserPolicy
{
    public function viewAny(User $actor): Response
    {
        return $this->adminOnly($actor);
    }

    public function create(User $actor): Response
    {
        return $this->adminOnly($actor);
    }

    public function update(User $actor, User $target): Response
    {
        return $this->sameOrganization($actor, $target) ?? $this->adminOnly($actor);
    }

    public function deactivate(User $actor, User $target): Response
    {
        if ($denied = $this->sameOrganization($actor, $target) ?? $this->deniedUnlessAdmin($actor)) {
            return $denied;
        }

        return $actor->is($target)
            ? Response::deny('You cannot deactivate your own account.')
            : Response::allow();
    }

    public function reactivate(User $actor, User $target): Response
    {
        return $this->update($actor, $target);
    }

    private function adminOnly(User $actor): Response
    {
        return $this->deniedUnlessAdmin($actor) ?? Response::allow();
    }

    private function deniedUnlessAdmin(User $actor): ?Response
    {
        return $actor->isAdmin() ? null : Response::deny('Only administrators can manage users.');
    }

    private function sameOrganization(User $actor, User $target): ?Response
    {
        return $actor->organization_id === $target->organization_id ? null : Response::denyAsNotFound();
    }
}
