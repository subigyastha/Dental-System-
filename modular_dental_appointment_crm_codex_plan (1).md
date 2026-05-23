# Modular Dental Appointment CRM — Codex Build Plan

## 1. Project Overview

### Project Name
**Modular Appointment & Client Management CRM**

### Initial Vertical
**Dental Clinic Appointment System**

### Long-Term Vision
Build a modular, multi-tenant CRM platform that can start with dental clinics but later adapt to other appointment-based service businesses such as clinics, law firms, consultancies, salons, wellness centers, and professional service providers.

The product should begin as an appointment-first system, but the architecture should be flexible enough to support future modules such as billing, documents, inventory, prescriptions, diagnosis, dental charting, case records, analytics, and business-specific templates.

---

## 2. Current Context

We have already started building an appointment system. Do **not** assume this is a fresh project unless the existing codebase is empty.

Codex should first inspect the existing project structure, identify already-created models, routes, pages, components, utilities, and database tables, then extend or refactor carefully.

### Important Instruction
Before adding new code:

1. Inspect existing files.
2. Identify current appointment-related implementation.
3. Avoid duplicate models, tables, routes, components, and utilities.
4. Preserve existing working behavior unless it conflicts with the architecture below.
5. Refactor only when necessary for maintainability, modularity, or correctness.
6. Add comments only where they clarify non-obvious business logic.

---

## 3. Core Product Goal for MVP

The MVP should be a **multi-tenant dental appointment and client management system** with the following capabilities:

1. Manage multiple organizations/clinics.
2. Manage multiple clinic locations/branches.
3. Manage users with roles.
4. Manage providers/doctors and their services.
5. Manage clients/patients.
6. Manage appointment creation, update, cancellation, arrival, completion, and no-show status.
7. Manage provider availability and blocked times.
8. Store basic appointment/session notes.
9. Maintain audit logs for important actions.
10. Keep the system ready for future dental charting, diagnosis, billing, inventory, and document modules.

---

## 4. Key Product Principles

### 4.1 Appointment-First, CRM-Ready
The first version should focus on appointment management, but it should not be designed as a narrow one-off appointment tool. It should be structured as the first module of a broader CRM system.

### 4.2 Multi-Tenant from the Start
Every business/clinic should be treated as a separate organization. Data must be scoped by `organization_id` wherever applicable.

This prevents future migration pain when multiple clinics/businesses use the same system.

### 4.3 Modular but Not Over-Engineered
The project should use modular code organization but should not prematurely introduce microservices.

Recommended approach:

- One application/codebase for MVP.
- Clear feature modules/folders.
- Shared utilities.
- Clean database relations.
- Service-layer functions for business logic.
- Future extraction should be possible, but not required now.

### 4.4 Practical MVP Scope
Do not build all possible features in the first phase.

Build only what is required to run the first dental appointment system properly:

- Organization
- Location
- Users/roles
- Providers
- Clients
- Services
- Availability
- Appointments
- Visit/session notes
- Audit logs

Future features should be represented as extension points, not fully built unless explicitly required.

### 4.5 Nepal Context
The system is being developed in Nepal and initially for Nepal-based clinics.

Consider:

- Default timezone: `Asia/Kathmandu`
- Phone numbers may use Nepali formats.
- Future Nepali calendar support may be required.
- English UI first is acceptable, but the structure should not prevent future Nepali localization.
- Dates should be stored in a reliable standard format and displayed locally.

### 4.6 Safe Expansion
The schema should support future verticals, but the MVP UI and workflows should remain dental-focused.

Example:

- Database entity can be called `client_profiles`, not only `patients`.
- UI can display “Patients” for dental clinics.
- Service can be generic, but examples can include “General Checkup”, “Scaling”, “Orthodontics”.

---

## 5. Recommended Technical Direction

### 5.1 Architecture
Use a **modular monolith** approach for MVP.

Avoid separate microservices at this stage.

### 5.2 Suggested Stack
If the current project already uses a different stack, inspect first and adapt accordingly. If the project is based on the planned stack, use:

- Frontend: Next.js
- Backend: Next.js API routes/server actions or route handlers
- Database: PostgreSQL
- ORM: Prisma or the existing ORM already used in the project
- Auth: NextAuth/Auth.js, Clerk, Supabase Auth, or existing auth solution
- File storage: Not required for MVP unless already implemented
- Deployment: Vercel or equivalent

### 5.3 Important Backend Guidance
Even if using Next.js full-stack, do not put all business logic directly inside route handlers or UI components.

Use a structure such as:

```txt
/src
  /app
  /components
  /features
    /appointments
    /clients
    /providers
    /services
    /locations
    /audit-logs
  /lib
    /auth
    /db
    /validation
    /time
  /server
    /services
    /repositories
    /policies
```

Use the current project convention if already established, but keep separation of concerns.

---

## 6. DRY Principle and Code Quality Approach

### 6.1 DRY: Do Not Repeat Business Logic
Appointment conflict detection, availability checks, role checks, and audit logging should not be repeated in multiple components or routes.

Create reusable functions/services such as:

```txt
checkAppointmentConflict()
getProviderAvailableSlots()
createAppointment()
updateAppointmentStatus()
writeAuditLog()
requireOrganizationAccess()
requireRole()
```

### 6.2 DRY Validation
Use shared validation schemas where possible.

Example:

```txt
appointmentCreateSchema
appointmentUpdateSchema
clientProfileSchema
serviceSchema
availabilitySchema
```

Use Zod or the validation library already present in the project.

### 6.3 DRY UI Components
Create reusable UI components for:

```txt
FormField
DateTimePicker
StatusBadge
DataTable
EmptyState
ConfirmDialog
CalendarSlot
RoleGuard
```

### 6.4 Centralized Constants
Keep statuses, roles, and reusable options centralized.

Example:

```txt
USER_ROLES
APPOINTMENT_STATUSES
APPOINTMENT_PRIORITIES
AUDIT_ACTIONS
DAYS_OF_WEEK
DEFAULT_TIMEZONE
```

### 6.5 Avoid Premature Abstraction
Do not create overly generic abstractions before they are needed.

Good:

- Generic `client_profiles` table.
- Reusable appointment logic.
- Feature folders.

Avoid for MVP:

- Full workflow engine.
- Plugin marketplace.
- Separate microservices.
- Highly abstract module registry unless explicitly needed.

---

## 7. Core Domain Model

### Main Entities

```txt
organizations
locations
users
client_profiles
services
provider_services
provider_availability
provider_unavailability
appointments
appointment_sessions
audit_logs
```

### Future Entities

```txt
diagnoses
dental_charts
dental_chart_teeth
billing_invoices
payments
documents
inventory_items
prescriptions
treatment_plans
```

---

## 8. Schema Details

> Important: If tables already exist, compare existing schema with this plan and migrate incrementally. Do not create duplicate tables with similar responsibilities.

---

### 8.1 organizations

Represents each business/clinic using the platform.

```txt
id                    UUID / CUID / serial primary key
name                  string, required
business_type          string, default: dental_clinic
email                 string, nullable
phone                 string, nullable
address               text, nullable
status                enum/string: active, inactive, suspended
created_at            timestamp
updated_at            timestamp
```

Recommended indexes:

```txt
status
business_type
```

---

### 8.2 locations

Represents branches or physical clinic locations.

```txt
id                    primary key
organization_id        foreign key -> organizations.id
name                  string, required
address               text, nullable
phone                 string, nullable
timezone              string, default: Asia/Kathmandu
is_active             boolean, default true
created_at            timestamp
updated_at            timestamp
```

Recommended indexes:

```txt
organization_id
organization_id + is_active
```

---

### 8.3 users

Represents login-capable users.

```txt
id                    primary key
organization_id        foreign key -> organizations.id, nullable for super_admin
name                  string, required
email                 string, unique where applicable
phone                 string, nullable
password_hash          string, nullable depending on auth provider
role                  enum/string
status                enum/string: active, inactive, invited, suspended
created_at            timestamp
updated_at            timestamp
```

Recommended roles:

```txt
SUPER_ADMIN
OWNER
MANAGER
PROVIDER
RECEPTIONIST
CLIENT
```

Notes:

- `SUPER_ADMIN` belongs to the platform operator and may not have `organization_id`.
- `OWNER`, `MANAGER`, `PROVIDER`, `RECEPTIONIST`, and `CLIENT` should generally be scoped to an organization.
- If using an external auth provider, avoid storing `password_hash` manually.

Recommended indexes:

```txt
organization_id
email
role
status
```

---

### 8.4 client_profiles

Represents clients/patients. A client may or may not have login access.

```txt
id                         primary key
organization_id             foreign key -> organizations.id
user_id                     foreign key -> users.id, nullable
full_name                   string, required
phone                       string, nullable
email                       string, nullable
gender                      string/enum, nullable
date_of_birth               date, nullable
address                     text, nullable
emergency_contact_name       string, nullable
emergency_contact_phone      string, nullable
medical_notes               text, nullable
allergies                   text, nullable
created_at                  timestamp
updated_at                  timestamp
```

Recommended indexes:

```txt
organization_id
organization_id + phone
organization_id + email
user_id
```

Important:

- Use `client_profiles` at database level for future cross-industry use.
- In dental UI, label this entity as “Patient”.

---

### 8.5 services

Represents services offered by the clinic/business.

```txt
id                         primary key
organization_id             foreign key -> organizations.id
name                       string, required
description                text, nullable
default_duration_minutes    integer, required
price                      decimal, nullable
is_active                  boolean, default true
created_at                 timestamp
updated_at                 timestamp
```

Examples:

```txt
General Checkup
Scaling
Orthodontics
Root Canal Consultation
Follow-up Visit
```

Recommended indexes:

```txt
organization_id
organization_id + is_active
```

---

### 8.6 provider_services

Maps providers to the services they offer.

```txt
id                         primary key
provider_id                foreign key -> users.id
service_id                 foreign key -> services.id
location_id                foreign key -> locations.id, nullable/customizable
custom_duration_minutes     integer, nullable
custom_price               decimal, nullable
is_active                  boolean, default true
created_at                 timestamp
updated_at                 timestamp
```

Recommended constraints:

```txt
provider_id should reference a user with role PROVIDER
unique(provider_id, service_id, location_id)
```

Recommended indexes:

```txt
provider_id
service_id
location_id
```

---

### 8.7 provider_availability

Defines regular working hours for a provider.

```txt
id                         primary key
provider_id                foreign key -> users.id
location_id                foreign key -> locations.id
day_of_week                integer, required // 0 Sunday, 1 Monday, etc.
start_time                 time, required
end_time                   time, required
slot_duration_minutes       integer, required
buffer_minutes             integer, default 0
is_active                  boolean, default true
created_at                 timestamp
updated_at                 timestamp
```

Notes:

- Nepal commonly treats Sunday as a working day; do not assume Saturday/Sunday weekend logic unless configured.
- `slot_duration_minutes` can be 15, 30, 45, 60, etc.
- `buffer_minutes` allows breaks between appointments.

Recommended indexes:

```txt
provider_id
location_id
provider_id + day_of_week
```

---

### 8.8 provider_unavailability

Defines blocked time, leave, breaks, holidays, or unavailable slots.

```txt
id                         primary key
provider_id                foreign key -> users.id
location_id                foreign key -> locations.id, nullable
start_datetime             timestamp with timezone preferred
end_datetime               timestamp with timezone preferred
reason                     text, nullable
created_by                 foreign key -> users.id
created_at                 timestamp
updated_at                 timestamp
```

Recommended indexes:

```txt
provider_id
start_datetime
end_datetime
provider_id + start_datetime + end_datetime
```

---

### 8.9 appointments

Core appointment table.

```txt
id                         primary key
organization_id             foreign key -> organizations.id
location_id                 foreign key -> locations.id
client_id                   foreign key -> client_profiles.id
provider_id                 foreign key -> users.id
service_id                  foreign key -> services.id
start_datetime              timestamp with timezone preferred
end_datetime                timestamp with timezone preferred
status                     enum/string
priority                   enum/string, nullable
notes                      text, nullable
cancellation_reason         text, nullable
created_by                 foreign key -> users.id, nullable
updated_by                 foreign key -> users.id, nullable
created_at                 timestamp
updated_at                 timestamp
```

Recommended appointment statuses:

```txt
PENDING
CONFIRMED
ARRIVED
LATE
IN_PROGRESS
COMPLETED
CANCELLED
NO_SHOW
RESCHEDULED
```

Recommended priorities:

```txt
LOW
NORMAL
HIGH
URGENT
```

Recommended indexes:

```txt
organization_id
location_id
client_id
provider_id
service_id
status
start_datetime
end_datetime
provider_id + start_datetime + end_datetime
organization_id + start_datetime
location_id + start_datetime
```

Important appointment rules:

1. A provider cannot have overlapping active appointments.
2. Cancelled appointments should not block availability.
3. No-show and completed appointments should remain in history.
4. Rescheduled appointments should either update the appointment and log the change, or create a linked rescheduled record later if needed.
5. For MVP, simple update + audit log is acceptable.

Conflict statuses to consider blocking:

```txt
PENDING
CONFIRMED
ARRIVED
LATE
IN_PROGRESS
```

Statuses that should not block new booking:

```txt
CANCELLED
NO_SHOW
COMPLETED
RESCHEDULED
```

---

### 8.10 appointment_sessions

Stores visit/session notes connected to an appointment.

```txt
id                         primary key
appointment_id              foreign key -> appointments.id
client_id                   foreign key -> client_profiles.id
provider_id                 foreign key -> users.id
service_id                  foreign key -> services.id
visit_summary               text, nullable
symptoms                    text, nullable
clinical_notes              text, nullable
doctor_notes                text, nullable
follow_up_required          boolean, default false
follow_up_date              date, nullable
created_at                  timestamp
updated_at                  timestamp
```

Notes:

- For MVP, this allows dental notes without building full diagnosis or dental charting.
- Later, diagnoses, prescriptions, dental charting, and treatment plans should connect to this table.

Recommended indexes:

```txt
appointment_id
client_id
provider_id
```

Recommended constraint:

```txt
unique(appointment_id) // if one session per appointment for MVP
```

---

### 8.11 audit_logs

Tracks important changes and actions.

```txt
id                         primary key
organization_id             foreign key -> organizations.id
actor_id                   foreign key -> users.id, nullable
entity_type                string, required
entity_id                  string/uuid, required
action                     string, required
old_value                  json/jsonb, nullable
new_value                  json/jsonb, nullable
description                text, nullable
created_at                 timestamp
```

Recommended entity types:

```txt
organization
location
user
client_profile
service
provider_service
provider_availability
provider_unavailability
appointment
appointment_session
```

Recommended audit actions:

```txt
created
updated
deleted
cancelled
rescheduled
status_changed
arrived
marked_late
completed
no_show
session_note_added
```

Recommended indexes:

```txt
organization_id
actor_id
entity_type + entity_id
created_at
organization_id + created_at
```

---

## 9. Future Schema Extensions

Do not build these fully in MVP unless requested. But keep current code extensible for them.

### 9.1 diagnoses

```txt
id
appointment_session_id
client_id
provider_id
diagnosis_title
diagnosis_description
severity
created_at
updated_at
```

### 9.2 dental_charts

```txt
id
client_id
organization_id
created_by
created_at
updated_at
```

### 9.3 dental_chart_teeth

```txt
id
dental_chart_id
tooth_number
condition
notes
last_updated_by
updated_at
```

### 9.4 billing_invoices

```txt
id
organization_id
client_id
appointment_id
invoice_number
amount
status
issued_at
due_at
created_at
updated_at
```

### 9.5 documents

```txt
id
organization_id
client_id
appointment_id
file_name
file_url
file_type
uploaded_by
created_at
```

---

## 10. Appointment Logic Requirements

### 10.1 Create Appointment
When creating an appointment:

1. Validate organization access.
2. Validate client belongs to organization.
3. Validate provider belongs to organization and has provider role.
4. Validate service belongs to organization.
5. Validate location belongs to organization.
6. Validate provider offers selected service, if `provider_services` is used.
7. Validate appointment time falls within provider availability.
8. Validate appointment time does not overlap provider unavailability.
9. Validate appointment does not overlap active appointments.
10. Create appointment.
11. Write audit log.

### 10.2 Update Appointment
When updating appointment date/time/provider/service/status:

1. Re-run conflict checks if time/provider/service changes.
2. Preserve history through audit logs.
3. Do not silently overwrite important appointment data.

### 10.3 Cancel Appointment
Cancellation should:

1. Set status to `CANCELLED`.
2. Store cancellation reason if provided.
3. Write audit log.
4. Free the slot for future booking.

### 10.4 Mark Arrival
Receptionist or manager can mark:

```txt
ARRIVED
LATE
NO_SHOW
```

Each status change should be logged.

### 10.5 Complete Appointment
When appointment is completed:

1. Set appointment status to `COMPLETED`.
2. Allow creating or updating `appointment_sessions`.
3. Store clinical/doctor notes if provided.
4. Write audit log.

---

## 11. Role and Permission Guidance

### SUPER_ADMIN
Platform-level admin.

Can:

- Manage all organizations.
- View system-level data.
- Create/suspend organizations.

### OWNER
Clinic/business owner.

Can:

- Manage organization settings.
- Manage locations.
- Manage users.
- Manage services.
- View all appointments and clients in organization.

### MANAGER
Operational manager.

Can:

- Manage appointments.
- Manage clients.
- Manage providers' schedules.
- View audit logs.

### RECEPTIONIST
Front-desk user.

Can:

- Create clients.
- Book appointments.
- Update appointment statuses.
- Cancel/reschedule appointments, depending on policy.

### PROVIDER
Doctor/service provider.

Can:

- View own appointments.
- Add visit/session notes.
- Mark appointment progress/completion.

### CLIENT
Client/patient login, optional for MVP.

Can eventually:

- View own appointments.
- Request appointment.
- Cancel/request reschedule based on rules.

For MVP, client login can be deferred if needed.

---

## 12. UI/UX Requirements

### 12.1 Main Admin/Clinic Views
Build practical screens first:

```txt
Dashboard
Appointments List
Appointment Calendar / Schedule View
Create Appointment
Edit Appointment
Clients/Patients List
Client/Patient Detail
Providers List
Provider Detail
Services List
Availability Settings
Audit Logs
```

### 12.2 Client/Patient Detail Page
Should show:

```txt
Basic client information
Appointment history
Cancelled/no-show records
Completed visits
Session/doctor notes
Future appointments
```

### 12.3 Appointment Detail Page
Should show:

```txt
Client
Provider
Service
Location
Date and time
Status
Priority
Notes
Session notes if completed/in progress
Audit history if available
```

### 12.4 Status Display
Use visible status badges for:

```txt
Pending
Confirmed
Arrived
Late
In Progress
Completed
Cancelled
No Show
Rescheduled
```

---

## 13. Development Milestones

## Milestone 0 — Existing Codebase Review

### Goal
Understand current appointment system implementation before making changes.

### Tasks

1. Inspect project structure.
2. Identify framework, ORM, auth, and database setup.
3. Locate existing appointment models/tables/routes/components.
4. Identify missing pieces compared to this plan.
5. Prepare implementation changes without duplicating existing work.

### Output

- Summary of current structure.
- List of files to modify.
- List of new files to add.
- Risks or conflicts found.

---

## Milestone 1 — Data Foundation

### Goal
Create or align database schema for core MVP.

### Build

```txt
organizations
locations
users/client auth alignment
client_profiles
services
provider_services
provider_availability
provider_unavailability
appointments
appointment_sessions
audit_logs
```

### Tasks

1. Add/adjust ORM schema.
2. Add migrations.
3. Add seed data for one demo dental clinic.
4. Add constants for roles, statuses, priorities, actions.
5. Add basic repository/service functions.

### Acceptance Criteria

- Database migrates successfully.
- Existing appointment system still works or is safely refactored.
- One clinic, one location, providers, clients, and services can be seeded.

---

## Milestone 2 — Organization, Location, and User Scoping

### Goal
Ensure data is correctly scoped by organization.

### Build

1. Organization selection/context.
2. Location management basics.
3. Role-aware access checks.
4. Organization-aware queries.

### Acceptance Criteria

- Users only access data from their organization unless super admin.
- Appointments are always tied to organization and location.
- No unscoped appointment queries exist.

---

## Milestone 3 — Client/Patient Management

### Goal
Allow staff to create and manage clients/patients.

### Build

1. Client list.
2. Create client.
3. Edit client.
4. Client detail page.
5. Client appointment history.

### Acceptance Criteria

- Staff can create clients without client login.
- Client profile stores basic medical notes and allergies.
- Client detail page shows appointment history.

---

## Milestone 4 — Services and Provider Setup

### Goal
Allow clinic to define services and assign providers.

### Build

1. Services CRUD.
2. Provider list.
3. Assign services to providers.
4. Configure provider custom duration/price if needed.

### Acceptance Criteria

- Services can be created and deactivated.
- Providers can be linked to services.
- Appointment booking can filter providers by selected service.

---

## Milestone 5 — Provider Availability

### Goal
Create scheduling foundation.

### Build

1. Provider regular availability.
2. Provider blocked time/unavailability.
3. Slot calculation utility.
4. Availability API/service.

### Acceptance Criteria

- Provider can have different availability by day.
- Provider can have blocked times.
- Available slots exclude blocked times and existing appointments.

---

## Milestone 6 — Appointment Engine

### Goal
Create robust appointment booking and management.

### Build

1. Create appointment.
2. Edit appointment.
3. Cancel appointment.
4. Reschedule appointment.
5. Update status.
6. Appointment list.
7. Appointment detail.
8. Calendar/schedule view if feasible.

### Acceptance Criteria

- Double booking is prevented.
- Cancelled appointments free the slot.
- Status changes are saved.
- Appointment creation validates provider, service, client, location, and organization.
- All important appointment actions generate audit logs.

---

## Milestone 7 — Appointment Session Notes

### Goal
Allow providers to add basic visit/session notes.

### Build

1. Session note form.
2. View session notes on appointment detail.
3. Show session history on client detail.

### Acceptance Criteria

- Provider/manager can add notes to an appointment.
- Session note is tied to appointment, provider, service, and client.
- Session note actions generate audit logs.

---

## Milestone 8 — Audit Logs

### Goal
Provide operational visibility before full analytics.

### Build

1. Audit log service.
2. Audit log table/page.
3. Entity-specific audit view, especially for appointments.

### Acceptance Criteria

- Appointment create/update/cancel/status change is logged.
- Session note creation/update is logged.
- Logs include actor, entity, action, timestamp, and changed values where practical.

---

## Milestone 9 — MVP Testing and Hardening

### Goal
Make the MVP usable for the first dental client.

### Tasks

1. Test appointment conflict cases.
2. Test cancellation and rescheduling.
3. Test provider availability.
4. Test organization scoping.
5. Test role permissions.
6. Test client history.
7. Test audit logs.
8. Fix UI friction.

### Acceptance Criteria

- Dental clinic can run daily appointment operations with the system.
- No obvious double-booking bugs.
- Staff can manage patients and visits.
- Audit logs provide useful traceability.

---

## 14. Suggested Folder Structure

Adapt to existing project structure where needed.

```txt
/src
  /app
    /(dashboard)
      /appointments
      /clients
      /providers
      /services
      /locations
      /audit-logs
  /components
    /ui
    /appointments
    /clients
    /providers
    /services
  /features
    /appointments
      appointment.constants.ts
      appointment.schemas.ts
      appointment.service.ts
      appointment.repository.ts
      appointment.types.ts
    /clients
    /providers
    /services
    /availability
    /audit-logs
  /lib
    /auth
    /db
    /time
    /validation
  /server
    /policies
    /repositories
    /services
```

If using Prisma:

```txt
/prisma
  schema.prisma
  /migrations
  seed.ts
```

---

## 15. Critical Edge Cases

### Appointment Conflicts
Prevent overlapping appointments for the same provider.

Overlap logic:

```txt
new_start < existing_end AND new_end > existing_start
```

Only active appointment statuses should block slots.

### Timezone
Store date-time consistently. Prefer timezone-aware timestamps. Display in `Asia/Kathmandu` by default.

### Provider Availability
Appointments should not be allowed outside provider availability unless manager/owner override is explicitly implemented.

For MVP, do not allow override unless requested.

### Cancelled Appointments
Cancelled appointments remain in history but should not block future booking.

### No-Show
No-show appointments remain in history and should be visible in client profile.

### Client Without Login
Receptionist should be able to create client records without requiring the client to have a login account.

### Organization Data Isolation
Never fetch clients, appointments, services, or providers without `organization_id` filtering unless super admin.

---

## 16. Seed Data Recommendation

Create seed data for local development:

```txt
Organization: Demo Dental Clinic
Location: Kathmandu Main Branch
Owner: owner@example.com
Manager: manager@example.com
Receptionist: receptionist@example.com
Provider 1: Dr. Asha Sharma
Provider 2: Dr. Ram Thapa
Services:
  - General Checkup, 30 minutes
  - Scaling, 45 minutes
  - Orthodontic Consultation, 60 minutes
Clients:
  - Demo Patient 1
  - Demo Patient 2
Availability:
  - Sunday to Friday, 10:00 to 17:00
  - Slot duration: 30 minutes
  - Buffer: 0 or 10 minutes
```

---

## 17. Recommended Implementation Order for Codex

Codex should implement in this order:

1. Review existing codebase.
2. Align schema/migrations.
3. Add constants and types.
4. Add validation schemas.
5. Add repositories/services for core entities.
6. Add appointment conflict and availability logic.
7. Add UI pages/forms for clients, services, providers, availability, and appointments.
8. Add session notes.
9. Add audit logging.
10. Add tests or manual test scripts where project supports them.
11. Improve UI/UX after core logic works.

---

## 18. Testing Checklist

### Appointment Booking

- Can create appointment inside provider availability.
- Cannot create appointment outside provider availability.
- Cannot double-book provider.
- Cannot book during blocked time.
- Can cancel appointment.
- Cancelled slot becomes available again.
- Can mark appointment as arrived.
- Can mark appointment as late.
- Can mark appointment as completed.
- Can mark appointment as no-show.

### Client Management

- Can create client without login.
- Can edit client.
- Can view client appointment history.
- Can view cancelled/no-show/completed appointments.

### Provider/Service

- Can create service.
- Can assign service to provider.
- Can set provider availability.
- Can set provider blocked time.

### Audit Logs

- Appointment creation is logged.
- Appointment update is logged.
- Appointment cancellation is logged.
- Status change is logged.
- Session note creation is logged.

### Multi-Tenant Safety

- User from one organization cannot access another organization’s data.
- Super admin can view/manage organizations if implemented.

---

## 19. Non-Goals for MVP

Do not build these in the first MVP unless explicitly requested:

```txt
Full billing module
Payment gateway
Inventory management
Dental tooth map/chart UI
Prescription system
Advanced analytics dashboard
SMS integration
WhatsApp integration
Email campaigns
Complex workflow engine
Separate microservices
Public client booking portal
Mobile app
```

These are future modules.

---

## 20. Future Roadmap

### Phase 2

```txt
Diagnosis per visit/session
Dental chart/tooth map
Treatment plans
Basic billing/invoices
Documents/uploads
SMS reminders
Client portal
```

### Phase 3

```txt
Analytics dashboard
Inventory module
Prescription module
Multi-vertical templates
Public booking page
Nepali calendar support
Role permission builder
```

### Phase 4

```txt
API access
Marketplace/integrations
Mobile app
Advanced automation
AI-assisted notes and insights
```

---

## 21. Final Instruction to Codex

Build this system incrementally. The immediate goal is not to create a massive CRM, but to create a strong, reliable appointment and client management foundation for a dental clinic.

The code should be clean, modular, and future-ready.

Prioritize:

1. Correct schema.
2. Clean business logic.
3. No double booking.
4. Organization-level data isolation.
5. Simple but useful UI.
6. Auditability.
7. Safe future expansion.

Do not over-engineer. Do not build unrelated future modules yet. Make the first appointment MVP excellent.
