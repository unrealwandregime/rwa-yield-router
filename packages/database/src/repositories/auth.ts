import { and, eq, gt, isNull, or } from "drizzle-orm";

import type { Database } from "../client.js";
import { administrators, roles, userRoles, users } from "../schema/index.js";

export interface AuthSubject {
  readonly provider: string;
  readonly subjectId: string;
}

export interface UserAuthorization {
  readonly userId: string;
  readonly status: typeof users.$inferSelect.status;
  readonly roles: ReadonlyArray<typeof roles.$inferSelect.code>;
  readonly isAdministrator: boolean;
  readonly isSecurityAdministrator: boolean;
  readonly mfaEnforced: boolean;
}

export const getUserAuthorizationByAuthSubject = async (
  database: Database,
  subject: AuthSubject,
  now: Date = new Date()
): Promise<UserAuthorization | null> => {
  const [user] = await database
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(
      and(eq(users.authProvider, subject.provider), eq(users.authSubjectId, subject.subjectId))
    )
    .limit(1);

  if (user === undefined) {
    return null;
  }

  const [roleRows, administratorRows] = await Promise.all([
    database
      .select({ code: roles.code })
      .from(userRoles)
      .innerJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
          eq(userRoles.userId, user.id),
          isNull(userRoles.revokedAt),
          or(isNull(userRoles.expiresAt), gt(userRoles.expiresAt, now))
        )
      ),
    database
      .select({ mfaEnforced: administrators.mfaEnforced })
      .from(administrators)
      .where(and(eq(administrators.userId, user.id), isNull(administrators.revokedAt)))
      .limit(1)
  ]);

  return {
    userId: user.id,
    status: user.status,
    roles: roleRows.map((row) => row.code),
    isAdministrator: administratorRows.length === 1 && roleRows.some((row) => row.code === "ADMIN"),
    isSecurityAdministrator:
      administratorRows.length === 1 && roleRows.some((row) => row.code === "SECURITY_ADMIN"),
    mfaEnforced: administratorRows[0]?.mfaEnforced ?? false
  };
};
