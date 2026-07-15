import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { Database } from "./client.js";
import { administrators, adminAuditLogs, roles, userRoles, users } from "./schema/index.js";
import { seedCanonicalReferenceData } from "./seed.js";

export interface InitialAdministratorSelector {
  readonly authSubjectId?: string;
  readonly email?: string;
  readonly provider?: string;
  readonly reason: string;
}

export interface InitialAdministratorGrantResult {
  readonly outcome: "ALREADY_GRANTED" | "GRANTED";
  readonly userId: string;
  readonly email: string | null;
  readonly mfaEnforced: true;
}

const normalizeSelector = (
  input: InitialAdministratorSelector
): Readonly<{
  authSubjectId: string | null;
  email: string | null;
  provider: string;
  reason: string;
}> => {
  const authSubjectId = input.authSubjectId?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  if ((authSubjectId === null) === (email === null)) {
    throw new Error("Provide exactly one administrator selector: email or auth subject");
  }
  const reason = input.reason.trim();
  if (reason.length < 8 || reason.length > 2_000) {
    throw new Error("Administrator grant reason must contain 8 to 2000 characters");
  }
  return {
    authSubjectId,
    email,
    provider: input.provider?.trim() || "supabase",
    reason
  };
};

export const grantInitialAdministrator = async (
  database: Database,
  input: InitialAdministratorSelector
): Promise<InitialAdministratorGrantResult> => {
  const selector = normalizeSelector(input);
  await seedCanonicalReferenceData(database);

  return database.transaction(async (transaction) => {
    let targetRows: ReadonlyArray<{ readonly email: string | null; readonly id: string }>;
    if (selector.authSubjectId === null) {
      if (selector.email === null) throw new Error("Administrator email is missing");
      targetRows = await transaction
        .select({ email: users.email, id: users.id })
        .from(users)
        .where(and(eq(users.email, selector.email), eq(users.status, "ACTIVE")))
        .limit(2);
    } else {
      targetRows = await transaction
        .select({ email: users.email, id: users.id })
        .from(users)
        .where(
          and(
            eq(users.authProvider, selector.provider),
            eq(users.authSubjectId, selector.authSubjectId),
            eq(users.status, "ACTIVE")
          )
        )
        .limit(2);
    }
    if (targetRows.length !== 1) {
      throw new Error(
        targetRows.length === 0
          ? "The target user must sign in once before administrator bootstrap"
          : "The administrator selector is ambiguous"
      );
    }
    const target = targetRows[0];
    if (target === undefined) throw new Error("Administrator target invariant failed");

    const [adminRole] = await transaction
      .select({ id: roles.id })
      .from(roles)
      .where(eq(roles.code, "ADMIN"))
      .limit(1);
    const [bootstrapActor] = await transaction
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.authProvider, "system"), eq(users.authSubjectId, "admin-bootstrap-v1")))
      .limit(1);
    if (adminRole === undefined || bootstrapActor === undefined) {
      throw new Error("Canonical administrator bootstrap references are missing");
    }

    const [existingRole] = await transaction
      .select({ revokedAt: userRoles.revokedAt })
      .from(userRoles)
      .where(and(eq(userRoles.userId, target.id), eq(userRoles.roleId, adminRole.id)))
      .limit(1);
    const [existingAdministrator] = await transaction
      .select({
        mfaEnforced: administrators.mfaEnforced,
        revokedAt: administrators.revokedAt
      })
      .from(administrators)
      .where(eq(administrators.userId, target.id))
      .limit(1);
    if (
      existingRole?.revokedAt === null &&
      existingAdministrator?.revokedAt === null &&
      existingAdministrator.mfaEnforced
    ) {
      return {
        email: target.email,
        mfaEnforced: true,
        outcome: "ALREADY_GRANTED",
        userId: target.id
      };
    }

    const grantedAt = new Date();
    await transaction
      .insert(userRoles)
      .values({
        grantedAt,
        grantedByUserId: bootstrapActor.id,
        roleId: adminRole.id,
        userId: target.id
      })
      .onConflictDoUpdate({
        target: [userRoles.userId, userRoles.roleId],
        set: {
          expiresAt: null,
          grantedAt,
          grantedByUserId: bootstrapActor.id,
          revokedAt: null
        }
      });
    await transaction
      .insert(administrators)
      .values({
        approvedAt: grantedAt,
        approvedByUserId: bootstrapActor.id,
        mfaEnforced: true,
        userId: target.id
      })
      .onConflictDoUpdate({
        target: administrators.userId,
        set: {
          approvedAt: grantedAt,
          approvedByUserId: bootstrapActor.id,
          mfaEnforced: true,
          revokedAt: null
        }
      });
    await transaction.insert(adminAuditLogs).values({
      action: "INITIAL_ADMINISTRATOR_GRANT",
      actorUserId: bootstrapActor.id,
      afterValue: {
        mfaEnforced: true,
        role: "ADMIN",
        userId: target.id
      },
      beforeValue: {
        administrator: existingAdministrator ?? null,
        role: existingRole ?? null
      },
      correlationId: randomUUID(),
      occurredAt: grantedAt,
      outcome: "APPROVED",
      reason: selector.reason,
      targetId: target.id,
      targetRecordVersion: 1,
      targetType: "USER_AUTHORIZATION",
      verificationDate: grantedAt
    });

    return {
      email: target.email,
      mfaEnforced: true,
      outcome: "GRANTED",
      userId: target.id
    };
  });
};
