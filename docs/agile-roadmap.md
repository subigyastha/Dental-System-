# Agile Delivery Roadmap

## Product Goal

Build a workflow-aware service scheduling and operational coordination platform, optimized first for dental clinics while keeping the domain model general enough for other service businesses.

## Sprint 1: Operational Command Center

Status: delivered

Outcome: Staff can see today’s schedule, operational risks, provider capacity, follow-up recovery work, and selected appointment workflow context from one screen.

Delivered in this slice:

- Next.js app foundation with TypeScript and Tailwind CSS
- Multi-tenant terminology in frontend domain types
- Seeded operational data for organization, providers, customers, services, appointments, and follow-up tasks
- Comprehensive dashboard with today schedule, attention queue, provider load, open follow-ups, and selected workflow details
- BS/AD display toggle with ISO/AD as the source of truth
- Prisma schema draft for multi-tenant scheduling, availability, blocked time, follow-ups, notifications, communication logs, and workflow events
- Supabase Postgres connection
- Database seed path
- Write-through APIs for appointment creation, workflow transitions, communication logs, and follow-up closure

Definition of done:

- Dashboard renders locally
- Calendar mode toggle works
- Provider filtering works
- Selecting an appointment updates workflow context
- TypeScript build passes

## Sprint 2: Scheduling Engine Foundation

Outcome: The system can generate safe candidate slots from provider availability, service duration, buffers, blocked time, and existing appointments.

Planned scope:

- Scheduling service module
- Slot generation function
- Overlap prevention
- Provider/resource constraints
- Unit tests for edge cases
- UI panel for suggested next available slots

## Sprint 3: Appointment Lifecycle

Outcome: Appointments behave like operational state machines instead of static calendar records.

Planned scope:

- Explicit transition rules
- Transition audit events
- Automatic follow-up task creation for no-show, cancelled, rescheduled, and follow-up-required states
- Communication log attachment
- UI action drawer for state movement

## Sprint 4: Persistence and Auth Boundary

Outcome: Replace seed data with PostgreSQL-backed records and organization-scoped access.

Planned scope:

- Prisma client setup
- Seed script
- Server-side data loading
- Organization isolation helpers
- Role-aware navigation and action availability
- Initial auth adapter boundary

## Sprint 5: Follow-Up Operations

Outcome: Follow-ups become a reliable recovery queue, not a static task list.

Planned scope:

- Follow-up board and queue filters
- SLA/due-state logic
- Recall and no-show recovery workflows
- Communication templates
- Notification queue preparation

## Sprint 6: Calendar and Availability Management

Outcome: Staff can manage provider availability and safely reschedule appointments.

Planned scope:

- Week/day calendar views
- BS-first date selection layer
- Availability editor
- Blocked time management
- Drag-free quick rescheduling flow optimized for operational accuracy
