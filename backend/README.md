# Backend (Laravel API)

Auth and single sign-on, RBAC, user management, document uploads and versions, the queue, the chat proxy and history, audit logs and analytics. Port 8000.

Setup, architecture, security model and the API reference are in the [root README](../README.md).

```powershell
php artisan serve --port=8000     # API
php artisan queue:work redis      # document processing (restart after changing job code)
php vendor\bin\pest               # tests (in-memory SQLite)
php vendor\bin\pint               # code style
```
