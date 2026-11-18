<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * One OpenID Connect identity provider per organization. People signing in
     * through it for the first time are provisioned with the defaults below;
     * clearance stays an administrator decision afterwards.
     */
    public function up(): void
    {
        Schema::create('sso_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->unique()->constrained()->cascadeOnDelete();
            $table->boolean('enabled')->default(false);
            $table->string('issuer');
            $table->string('client_id');
            $table->text('client_secret'); // encrypted cast
            // Only emails in this domain may use this connection, e.g. acme.test
            $table->string('email_domain')->unique();
            $table->foreignId('default_department_id')->constrained('departments')->restrictOnDelete();
            $table->string('default_role', 20)->default('staff');
            $table->unsignedTinyInteger('default_clearance_level')->default(1);
            $table->timestamps();
        });

        Schema::table('users', function (Blueprint $table) {
            $table->string('sso_subject')->nullable()->after('email');
        });
    }

    public function down(): void
    {
        Schema::table('users', fn (Blueprint $table) => $table->dropColumn('sso_subject'));
        Schema::dropIfExists('sso_connections');
    }
};
