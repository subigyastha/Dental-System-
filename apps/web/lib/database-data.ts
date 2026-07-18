import type {
  Appointment,
  Customer,
  FollowUpTask,
  Location,
  Organization,
  Provider,
  Service,
  StaffMember,
  VisitReport,
} from "@/lib/domain";

/**
 * The data required to render the existing workspace shell.
 *
 * It is intentionally a type-only module. Operational data is fetched by the
 * authenticated browser from NestJS; Next.js must not fall back to Prisma,
 * seed data, or a different organization when that request is unavailable.
 */
export type OperationalData = {
  organization: Organization;
  providers: Provider[];
  staff: StaffMember[];
  customers: Customer[];
  services: Service[];
  locations: Location[];
  appointments: Appointment[];
  followUps: FollowUpTask[];
  visitReports: VisitReport[];
  databaseConnected: boolean;
};
