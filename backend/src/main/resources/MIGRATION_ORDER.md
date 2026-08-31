# EasyChat V2 deployment migration order

Apply these SQL files once, in this order, against the production MySQL schema
before deploying a node that enables V2 schema validation:

1. `db-migration-p0-auth.sql`
2. `db-migration-p1-reliable-events.sql`
3. `db-migration-p1-reliable-events-v2.sql`
4. `db-migration-p1-1-v2-events.sql`
5. `db-migration-p1-2-ha-gates.sql`
6. `db-migration-p1-3-event-outbox-collation.sql`

The application validates the resulting tables, column, and outbox route index
on startup. Do not disable `easychat.schema-validation.enabled` in production.
